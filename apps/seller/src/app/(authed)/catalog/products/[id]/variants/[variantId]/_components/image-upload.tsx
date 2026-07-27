'use client';

import { useCallback, useRef, useState, type DragEvent, type ReactElement } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { ApiError } from '@skydrop/api-client';
import {
  useDeleteImage,
  usePresignImage,
  useRegisterImage,
  useVariantImages,
} from '@/lib/api-hooks';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '@skydrop/ui/components';

/**
 * Variant image upload — drag-drop multi (up to MAX concurrent,
 * sequential presign-per-file network). The flow per file:
 *   1. POST /seller/images/presign — get presigned S3 URL + spacesKey.
 *   2. PUT bytes to the presigned URL.
 *   3. POST /seller/images — register with spacesKey + metadata.
 * In-row status badges (queued / uploading / done / error). On error,
 * the row surfaces the server's `[code] message` VERBATIM (FE-2).
 *
 * MAX is hardcoded to 5 for Phase 1A (matches the system_setting
 * default seeded in the M4 catalog work); a future iteration can read
 * the live value via a dedicated /seller/catalog/settings endpoint.
 */

const MAX_UPLOAD_BATCH = 5;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface UploadItem {
  readonly id: string;
  readonly file: File;
  status: 'queued' | 'uploading' | 'registering' | 'done' | 'error';
  errorCode: string | null;
  errorMessage: string | null;
}

export function VariantImageUpload({ variantId }: { variantId: string }): ReactElement {
  const images = useVariantImages(variantId);
  const presign = usePresignImage();
  const register = useRegisterImage();
  const deleteImg = useDeleteImage();

  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files).slice(0, MAX_UPLOAD_BATCH);
      const items: UploadItem[] = incoming.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: ACCEPTED_TYPES.includes(file.type) ? 'queued' : 'error',
        errorCode: ACCEPTED_TYPES.includes(file.type) ? null : 'INVALID_TYPE',
        errorMessage: ACCEPTED_TYPES.includes(file.type)
          ? null
          : `Only ${ACCEPTED_TYPES.join(', ')} accepted.`,
      }));
      setQueue((q) => [...q, ...items].slice(-MAX_UPLOAD_BATCH * 2));
      // Kick off uploads for queued items.
      for (const item of items) {
        if (item.status === 'queued') void uploadOne(item);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variantId, presign, register],
  );

  const uploadOne = useCallback(
    async (item: UploadItem): Promise<void> => {
      setQueue((q) => q.map((it) => (it.id === item.id ? { ...it, status: 'uploading' } : it)));
      try {
        // 1. Presign.
        const presignResp = await presign.mutateAsync({
          variantId,
          filename: item.file.name,
          contentType: item.file.type,
          sizeBytes: item.file.size,
        });

        // 2. PUT to S3. The presigned URL hits Spaces directly (NOT
        // our API), so we DON'T go through ApiClient — raw fetch
        // with a content-type header keeps the upload simple. On
        // failure we throw a regular Error carrying the S3 status;
        // the catch path routes it to a generic UPLOAD_FAILED.
        const putRes = await fetch(presignResp.uploadUrl, {
          method: 'PUT',
          body: item.file,
          headers: { 'content-type': item.file.type },
        });
        if (!putRes.ok) {
          throw new Error(`S3 returned ${putRes.status}`);
        }

        // 3. Register.
        setQueue((q) => q.map((it) => (it.id === item.id ? { ...it, status: 'registering' } : it)));
        await register.mutateAsync({
          variantId,
          spacesKey: presignResp.spacesKey,
          filename: item.file.name,
          contentType: item.file.type,
          sizeBytes: item.file.size,
        });

        setQueue((q) =>
          q.map((it) =>
            it.id === item.id ? { ...it, status: 'done', errorCode: null, errorMessage: null } : it,
          ),
        );
      } catch (err) {
        // FE-2 — surface the server verdict VERBATIM. The ApiError's
        // body carries the server's {code, message}; we read both
        // straight from there.
        let code = 'UPLOAD_FAILED';
        let message = 'Upload failed.';
        if (err instanceof ApiError) {
          if (
            typeof err.body === 'object' &&
            err.body !== null &&
            'code' in err.body &&
            'message' in err.body
          ) {
            const b = err.body as { code?: unknown; message?: unknown };
            if (typeof b.code === 'string') code = b.code;
            if (typeof b.message === 'string') message = b.message;
          } else {
            code = err.code ?? 'UPLOAD_FAILED';
            message = err.message;
          }
        } else if (err instanceof Error) {
          message = err.message;
        }
        setQueue((q) =>
          q.map((it) =>
            it.id === item.id
              ? { ...it, status: 'error', errorCode: code, errorMessage: message }
              : it,
          ),
        );
      }
    },
    [variantId, presign, register],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files.length > 0) acceptFiles(e.dataTransfer.files);
    },
    [acceptFiles],
  );

  return (
    <Card>
      <CardHeader
        title="Images"
        subtitle={`Drag up to ${MAX_UPLOAD_BATCH} files at once. JPG / PNG / WEBP.`}
      />
      <CardBody className="space-y-3">
        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          className={
            'rounded-[7px] border-2 border-dashed px-4 py-8 text-center transition-colors cursor-pointer ' +
            (dragActive
              ? 'border-accent bg-[var(--color-accent-tint)]'
              : 'border-border hover:border-border-strong')
          }
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={20} className="mx-auto text-text-muted mb-2" />
          <div className="text-text-body text-sm">Drop images here or click to browse</div>
          <div className="text-text-faint text-xs mt-1">
            JPG / PNG / WEBP · up to {MAX_UPLOAD_BATCH} at once
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES.join(',')}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) acceptFiles(e.target.files);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
        </div>

        {/* Upload queue */}
        {queue.length > 0 && (
          <ul className="space-y-1.5">
            {queue.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 px-2 py-1.5 rounded-[5px] bg-surface-raised border border-border"
              >
                <span className="text-text-body text-sm flex-1 min-w-0 truncate font-mono text-xs">
                  {item.file.name}
                </span>
                <UploadStatusBadge status={item.status} />
                {item.status === 'error' && item.errorCode && (
                  <span className="text-critical text-xs font-mono">
                    [{item.errorCode}] {item.errorMessage}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Persisted images */}
        <div className="pt-3 border-t border-border">
          {images.isLoading ? (
            <LoadingState label="Loading images…" />
          ) : images.isError ? (
            <ErrorState
              message={images.error?.message ?? 'Failed to load images.'}
              retry={() => void images.refetch()}
            />
          ) : !images.data || images.data.length === 0 ? (
            <EmptyState
              title="No images yet"
              description="Drop a file above to upload your first."
            />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {images.data.map((img) => (
                <div
                  key={img.id}
                  className="rounded-[5px] border border-border bg-surface-raised overflow-hidden"
                >
                  {/* Plain img — Next/Image would need a remotePatterns
                       allowlist; deferred for Phase 2 optimizations. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.thumbnailUrl ?? img.displayUrl}
                    alt={img.altText ?? 'Variant image'}
                    className="w-full aspect-square object-cover"
                  />
                  <div className="flex items-center justify-between px-2 py-1.5 text-xs">
                    <span className="text-text-faint font-mono truncate">
                      {Math.round(img.sizeBytes / 1024)} KB
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void deleteImg.mutateAsync(img.id)}
                      disabled={deleteImg.isPending}
                      title="Delete image"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function UploadStatusBadge({ status }: { status: UploadItem['status'] }): ReactElement {
  const kind =
    status === 'done'
      ? ('delivered' as const)
      : status === 'error'
        ? ('failed' as const)
        : status === 'queued'
          ? ('pending' as const)
          : ('in-transit' as const);
  return <StatusBadge kind={kind} label={status} />;
}
