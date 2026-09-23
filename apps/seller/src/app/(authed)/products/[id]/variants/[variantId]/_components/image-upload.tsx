'use client';

import { useCallback, useState, type ReactElement } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError } from '@skydrop/api-client';
import {
  useDeleteImage,
  usePresignImage,
  useRegisterImage,
  useVariantImages,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { DropZone } from '@skydrop/ui/app/drop-zone';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Note } from '@/app/(authed)/inventory/_components/stock-ui';

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
 * the live value via a dedicated /seller/products/settings endpoint.
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

export function VariantImageUpload({
  variantId,
  skuCode,
}: {
  variantId: string;
  /** Named in the delete confirm, so it says whose picture goes. */
  skuCode?: string | undefined;
}): ReactElement {
  const images = useVariantImages(variantId);
  const presign = usePresignImage();
  const register = useRegisterImage();
  const deleteImg = useDeleteImage();

  const [queue, setQueue] = useState<UploadItem[]>([]);
  // The picture a delete is waiting on its confirm for, and its verdict.
  const [pendingDelete, setPendingDelete] = useState<{
    readonly id: string;
    readonly position: number;
    readonly sizeKb: number;
    readonly src: string;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
        // The API takes the variant on the path and only the mime type
        // in the body — it whitelists fields, so anything else is a 400.
        const presignResp = await presign.mutateAsync({
          variantId,
          body: { mimeType: item.file.type },
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
          body: {
            spacesKey: presignResp.spacesKey,
            mimeType: item.file.type,
            sizeBytes: item.file.size,
          },
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

  const total = images.data?.length ?? 0;

  // No card and no head of its own: the caller's section panel is the
  // surface. The drag hint leads the drop zone, where the person about to
  // drop something is looking. The zone only hands files over; the
  // presign → PUT → register flow above is unchanged.
  return (
    <div className="inv-stack">
      <Note>Drag up to {MAX_UPLOAD_BATCH} files at once. JPG / PNG / WEBP.</Note>
      <DropZone
        label="Drop images here or click to browse"
        hint={`JPG / PNG / WEBP · up to ${MAX_UPLOAD_BATCH} at once`}
        buttonText="Choose images"
        accept={ACCEPTED_TYPES.join(',')}
        multiple
        showFiles={false}
        // A dropped file of the wrong type still reaches acceptFiles, which
        // lists it as an INVALID_TYPE row exactly as before.
        filterDropped={false}
        onFiles={(files) => acceptFiles(files)}
      />

      {/* Upload queue */}
      {queue.length > 0 && (
        <ul className="prd-uploads" aria-label="Uploads">
          {queue.map((item) => (
            <li key={item.id} className="prd-upload">
              <span className="prd-upload__name">{item.file.name}</span>
              <UploadStatusBadge status={item.status} />
              {item.status === 'error' && item.errorCode && (
                <span className="inv-num" data-tone="bad" style={{ fontSize: 'var(--fs-xs)' }}>
                  [{item.errorCode}] {item.errorMessage}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Persisted images */}
      <div>
        {images.isLoading ? (
          <SkeletonRows rows={2} label="Loading images…" />
        ) : images.isError ? (
          <ErrorState
            message={images.error?.message ?? 'Failed to load images.'}
            retry={() => void images.refetch()}
          />
        ) : !images.data || images.data.length === 0 ? (
          <EmptyState
            bare
            title="No images yet"
            description="Drop a file above to upload your first."
          />
        ) : (
          <ul className="prd-gallery" aria-label="Pictures">
            {images.data.map((img, i) => (
              <li key={img.id} className="prd-gallery__item">
                {/* Plain img — Next/Image would need a remotePatterns
                       allowlist; deferred for Phase 2 optimizations. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbnailUrl ?? img.displayUrl}
                  alt={img.altText ?? 'Variant image'}
                  className="prd-gallery__img"
                />
                <div className="prd-gallery__bar">
                  <span className="sk-figure">{Math.round(img.sizeBytes / 1024)} KB</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={14} />}
                    onClick={() => {
                      setDeleteError(null);
                      setPendingDelete({
                        id: img.id,
                        position: i + 1,
                        sizeKb: Math.round(img.sizeBytes / 1024),
                        src: img.thumbnailUrl ?? img.displayUrl,
                      });
                    }}
                    disabled={deleteImg.isPending}
                    title="Delete image"
                    aria-label="Delete image"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
        title="Delete this picture?"
        entity={
          pendingDelete === null
            ? ''
            : `${skuCode ?? 'This SKU'} · picture ${pendingDelete.position} of ${total} · ${pendingDelete.sizeKb} KB`
        }
        consequence="It is removed from this SKU and customers stop seeing it beside the product. To show it again you upload it again."
        confirmLabel="Delete picture"
        destructive
        error={deleteError ?? undefined}
        onConfirm={async () => {
          if (pendingDelete === null) return;
          try {
            await deleteImg.mutateAsync({ variantId, imageId: pendingDelete.id });
          } catch (err) {
            setDeleteError(serverVerdict(err));
            throw err;
          }
        }}
      >
        {pendingDelete !== null && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pendingDelete.src} alt="" className="prd-thumb prd-thumb--lg" />
        )}
      </ConfirmDialog>
    </div>
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
  return <StatusChip kind={kind} label={status} size="sm" />;
}
