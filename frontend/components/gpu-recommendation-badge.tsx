'use client'

import { ReactNode } from 'react'

export interface GpuRecommendationBadgeProps {
  model: string
  provider: string
  vram: string
  price: string
  roi: string
  rank: number
  isTop?: boolean
  isQualified?: boolean
}

export function GpuRecommendationBadge({
  model,
  provider,
  vram,
  price,
  roi,
  rank,
  isTop = false,
  isQualified = false,
}: GpuRecommendationBadgeProps) {
  const topBadge = isTop ? (
    <span className="top-badge">TOP</span>
  ) : null

  const qualifiedBadge = isQualified ? (
    <span className="average-badge">QUALIFIED</span>
  ) : null

  return (
    <div className="gpu-recommendation-card">
      {/* Model name with Fraunces serif font */}
      <div className="gpu-model-name">{model}</div>
      
      {/* Specs with JetBrains Mono */}
      <div className="gpu-specs">
        <strong>Provider:</strong> {provider} &nbsp;|&nbsp; 
        <strong>VRAM:</strong> {vram}GB &nbsp;|&nbsp; 
        <strong>Price:</strong> {price}/hr &nbsp;|&nbsp; 
        <strong>ROI:</strong> {roi}%
      </div>
      
      {/* Provider offer badge */}
      <div className="provider-offer">
        Rank #{rank}
      </div>
      
      {/* Badges: TOP + QUALIFIED */}
      <div className="badges">
        {topBadge}
        {qualifiedBadge}
      </div>
    </div>
  )
}