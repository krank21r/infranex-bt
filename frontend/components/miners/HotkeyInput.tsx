'use client'

import { useEffect, useState, useCallback } from 'react'
import { Clipboard, Check, Loader2, AlertCircle, Info } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  parseHotkey,
  formatHotkey,
  readFromClipboard,
  copyToClipboard,
} from '@/lib/wallet'
import { useValidateHotkey } from '@/hooks/useUserMiners'
import type { HotkeyValidationResult } from '@/types'

export type HotkeyValidationState = 'idle' | 'invalid' | 'checking' | 'valid' | 'invalid-on-chain'

interface HotkeyInputProps {
  value: string
  onChange: (value: string) => void
  netuid?: number
  onValidationComplete?: (result: HotkeyValidationResult | null) => void
  label?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  className?: string
}

export function HotkeyInput({
  value,
  onChange,
  netuid,
  onValidationComplete,
  label = 'Hotkey (SS58 Address)',
  placeholder = '5GrwvaEF... or paste your hotkey address',
  required = false,
  disabled = false,
  className,
}: HotkeyInputProps) {
  const [localState, setLocalState] = useState<HotkeyValidationState>('idle')
  const [copied, setCopied] = useState(false)
  const [pasteError, setPasteError] = useState<string | null>(null)

  const validation = useValidateHotkey()

  const formatCheck = parseHotkey(value)
  const isFormatValid = formatCheck.valid

  useEffect(() => {
    if (!value) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalState('idle')
      onValidationComplete?.(null)
      return
    }
    if (!isFormatValid) {
      setLocalState('invalid')
      onValidationComplete?.(null)
      return
    }
    if (netuid === undefined || netuid === null) {
      setLocalState('idle')
      return
    }
    setLocalState('checking')
    const timer = setTimeout(() => {
      validation.mutate(
        { hotkey: value.trim(), netuid },
        {
          onSuccess: (res) => {
            if (res.valid && res.on_chain) {
              setLocalState('valid')
            } else {
              setLocalState('invalid-on-chain')
            }
            onValidationComplete?.(res)
          },
          onError: () => {
            setLocalState('invalid-on-chain')
            onValidationComplete?.(null)
          },
        }
      )
    }, 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, netuid, isFormatValid])

  const handlePaste = useCallback(async () => {
    setPasteError(null)
    try {
      const text = await readFromClipboard()
      if (text) {
        onChange(text.trim())
      } else {
        setPasteError('Clipboard access denied')
      }
    } catch {
      setPasteError('Failed to read clipboard')
    }
  }, [onChange])

  const handleCopy = useCallback(async () => {
    if (!value) return
    const ok = await copyToClipboard(value)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }, [value])

  const statusBadge = (() => {
    if (localState === 'checking') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Checking on-chain…
        </span>
      )
    }
    if (localState === 'valid') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-success">
          <Check className="h-3 w-3" /> Valid hotkey found on-chain
        </span>
      )
    }
    if (localState === 'invalid') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" /> {formatCheck.error || 'Invalid SS58 address'}
        </span>
      )
    }
    if (localState === 'invalid-on-chain') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-warning">
          <AlertCircle className="h-3 w-3" /> Hotkey not registered on this subnet
        </span>
      )
    }
    return null
  })()

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor="hotkey-input" className="flex items-center gap-1">
          {label}
          {required && <span className="text-destructive">*</span>}
        </Label>
        {value && isFormatValid && (
          <span className="text-xs text-muted-foreground font-mono">{formatHotkey(value)}</span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          id="hotkey-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'font-mono text-sm',
            localState === 'valid' && 'border-success focus-visible:ring-success/30',
            (localState === 'invalid' || localState === 'invalid-on-chain') &&
              'border-destructive/60 focus-visible:ring-destructive/30'
          )}
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handlePaste}
          disabled={disabled}
          title="Paste from clipboard"
          aria-label="Paste from clipboard"
        >
          <Clipboard className="h-4 w-4" />
        </Button>
        {value && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleCopy}
            disabled={disabled}
            title={copied ? 'Copied!' : 'Copy hotkey'}
            aria-label="Copy hotkey"
          >
            {copied ? <Check className="h-4 w-4 text-success" /> : <Clipboard className="h-4 w-4" />}
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between min-h-[1.25rem]">
        <div className="text-xs">
          {statusBadge}
          {pasteError && <span className="text-destructive ml-2">{pasteError}</span>}
        </div>
      </div>
      <div className="rounded-md bg-muted/40 border border-border/60 p-3 text-xs text-muted-foreground flex gap-2">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <p>
          Your <span className="font-medium text-foreground">hotkey</span> is the public SS58 address
          of your Bittensor miner wallet. It identifies your miner on-chain and is used to verify
          ownership. Never share your coldkey or mnemonic.
        </p>
      </div>
    </div>
  )
}