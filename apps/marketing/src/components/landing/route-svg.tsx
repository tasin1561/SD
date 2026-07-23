'use client';

import { useReducedMotion, motion } from 'framer-motion';
import type { ReactElement } from 'react';

/**
 * BD → IN route animation. The single signature visual per skill.
 * Draws a glowing sky-blue arc, then lights 4 nodes in sequence:
 *   Warehouse → Call confirm → Dispatch → Delivered.
 * SVG + framer-motion pathLength only — no external libs.
 * Honors prefers-reduced-motion (renders static, no animation).
 */
interface RouteNode {
  x: number;
  y: number;
  label: string;
  muted?: boolean;
  accent?: 'sky' | 'saffron';
}

const NODES: RouteNode[] = [
  { x: 90, y: 195, label: 'Warehouse (BD)', muted: true },
  { x: 220, y: 105, label: 'Call confirm' },
  { x: 380, y: 155, label: 'Dispatch' },
  { x: 510, y: 90, label: 'Delivered (IN)', accent: 'saffron' },
];

// A smooth arc BD → IN through the sequenced nodes.
const PATH_D =
  'M 90,195 C 140,60 200,120 220,105 S 320,220 380,155 S 470,50 510,90';

export function RouteSvg(): ReactElement {
  const prefersReduced = useReducedMotion();

  return (
    <div className="relative w-full aspect-[6/4] max-w-[620px] mx-auto">
      <svg
        viewBox="0 0 600 300"
        className="w-full h-full"
        role="img"
        aria-label="Illustration of a parcel route from Bangladesh through warehousing, call confirmation, and dispatch to delivery in India"
      >
        <defs>
          <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--sky)" stopOpacity="0.15" />
            <stop offset="50%" stopColor="var(--sky)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--saffron)" stopOpacity="0.7" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Base grid dots — soft, quiet, atmospheric */}
        <g opacity="0.15">
          {Array.from({ length: 12 }).map((_, i) =>
            Array.from({ length: 6 }).map((_, j) => (
              <circle
                key={`${i}-${j}`}
                cx={50 + i * 50}
                cy={30 + j * 45}
                r="1"
                fill="var(--muted-dark)"
              />
            )),
          )}
        </g>

        {/* Route base (dim) */}
        <path
          d={PATH_D}
          stroke="rgba(56,189,248,0.15)"
          strokeWidth="2"
          fill="none"
        />

        {/* Route animated (glowing) */}
        <motion.path
          d={PATH_D}
          stroke="url(#routeGrad)"
          strokeWidth="2.5"
          fill="none"
          filter="url(#glow)"
          initial={prefersReduced ? { pathLength: 1 } : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: prefersReduced ? 0 : 2.4, ease: 'easeInOut', delay: 0.2 }}
          strokeLinecap="round"
        />

        {/* Nodes */}
        {NODES.map((n, i) => {
          const isEnd = n.accent === 'saffron';
          return (
            <g key={n.label}>
              {/* Outer ring — pulses on activation, then static */}
              <motion.circle
                cx={n.x}
                cy={n.y}
                r="14"
                fill="none"
                stroke={isEnd ? 'var(--saffron)' : 'var(--sky)'}
                strokeWidth="1.5"
                initial={prefersReduced ? { opacity: 0.5, scale: 1 } : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 0.5, scale: 1 }}
                transition={{ duration: 0.4, delay: prefersReduced ? 0 : 0.5 + i * 0.5 }}
                style={{ transformOrigin: `${n.x}px ${n.y}px` }}
              />
              {/* Solid dot */}
              <motion.circle
                cx={n.x}
                cy={n.y}
                r="6"
                fill={isEnd ? 'var(--saffron)' : 'var(--sky)'}
                initial={prefersReduced ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: prefersReduced ? 0 : 0.5 + i * 0.5 }}
                style={{ transformOrigin: `${n.x}px ${n.y}px` }}
              />
              {/* Label */}
              <motion.text
                x={n.x}
                y={n.y + 32}
                fill={n.muted ? 'var(--muted-dark)' : 'var(--white)'}
                fontSize="11"
                fontFamily="var(--font-mono), monospace"
                textAnchor="middle"
                initial={prefersReduced ? { opacity: 1 } : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: prefersReduced ? 0 : 0.7 + i * 0.5 }}
              >
                {n.label}
              </motion.text>
            </g>
          );
        })}

        {/* BD / IN region labels — quiet corner captions */}
        <text
          x="30"
          y="270"
          fill="var(--muted-dark)"
          fontSize="10"
          fontFamily="var(--font-mono), monospace"
          opacity="0.5"
        >
          BD
        </text>
        <text
          x="560"
          y="270"
          fill="var(--muted-dark)"
          fontSize="10"
          fontFamily="var(--font-mono), monospace"
          textAnchor="end"
          opacity="0.5"
        >
          IN
        </text>
      </svg>
    </div>
  );
}
