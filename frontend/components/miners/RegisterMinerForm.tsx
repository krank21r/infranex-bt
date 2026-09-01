'use client'

import { useMemo, useState } from 'react'
import { Loader2, Save, X, Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSubnets } from '@/hooks/useSubnets'
import { useRegisterMiner } from '@/hooks/useUserMiners'
import { parseHotkey } from '@/lib/wallet'
import { HotkeyInput } from './HotkeyInput'
import type { HotkeyValidationResult, MinerRegistration } from '@/types'

export interface RegisterMinerFormProps {
  defaultNetuid?: number
  onSuccess?: (minerId: string) => void
  onCancel?: () => void
  className?: string
}

interface FormErrors {
  name?: string
  hotkey?: string
  netuid?: string
  description?: string
  tags?: string
}

export function RegisterMinerForm({
  defaultNetuid,
  onSuccess,
  onCancel,
  className,
}: RegisterMinerFormProps) {
  const [name, setName] = useState('')
  const [netuid, setNetuid] = useState<number | ''>(defaultNetuid ?? '')
  const [hotkey, setHotkey] = useState('')
  const [description, setDescription] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [chainValidation, setChainValidation] = useState<HotkeyValidationResult | null>(null)

  const { data: subnetsData, isLoading: subnetsLoading } = useSubnets({ page_size: 100 })
  const register = useRegisterMiner()

  const subnets = useMemo(() => {
    const items = subnetsData?.data ?? []
    return items.filter((s) => s.registration_open !== false)
  }, [subnetsData])

  const validate = (): FormErrors => {
    const e: FormErrors = {}
    if (!name.trim()) e.name = 'Miner name is required'
    else if (name.length < 3) e.name = 'Name must be at least 3 characters'
    else if (name.length > 64) e.name = 'Name must be 64 characters or fewer'

    if (!hotkey.trim()) e.hotkey = 'Hotkey is required'
    else if (!parseHotkey(hotkey).valid) e.hotkey = 'Invalid SS58 address'

    if (netuid === '' || netuid === undefined) e.netuid = 'Select a subnet'
    else if (chainValidation && !chainValidation.valid) {
      e.hotkey = chainValidation.message || 'Hotkey not valid on-chain'
    }

    if (description.length > 500) e.description = 'Description must be 500 characters or fewer'

    if (tags.length > 10) e.tags = 'Maximum 10 tags allowed'

    return e
  }

  const handleAddTag = () => {
    const t = tagInput.trim().toLowerCase()
    if (!t) return
    if (tags.includes(t)) {
      setTagInput('')
      return
    }
    if (tags.length >= 10) return
    setTags([...tags, t])
    setTagInput('')
  }

  const handleRemoveTag = (t: string) => {
    setTags(tags.filter((x) => x !== t))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError(null)
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return

    const payload: MinerRegistration = {
      name: name.trim(),
      hotkey: hotkey.trim(),
      netuid: Number(netuid),
      description: description.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
    }

    try {
      const miner = await register.mutateAsync(payload)
      onSuccess?.(miner.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      setServerError(message)
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Register New Miner</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="space-y-2">
            <Label htmlFor="name">
              Miner Name<span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. titan-miner-01"
              disabled={register.isPending}
              maxLength={64}
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="netuid">
              Subnet<span className="text-destructive">*</span>
            </Label>
            <Select
              value={netuid === '' ? '' : String(netuid)}
              onValueChange={(v) => setNetuid(Number(v))}
              disabled={register.isPending || subnetsLoading}
            >
              <SelectTrigger id="netuid" aria-invalid={!!errors.netuid}>
                <SelectValue
                  placeholder={subnetsLoading ? 'Loading subnets…' : 'Select a subnet'}
                />
              </SelectTrigger>
              <SelectContent>
                {subnets.map((s) => (
                  <SelectItem key={s.id ?? s.netuid} value={String(s.netuid)}>
                    <span className="font-mono text-xs text-muted-foreground mr-2">
                      #{s.netuid}
                    </span>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.netuid && <p className="text-xs text-destructive">{errors.netuid}</p>}
          </div>

          <HotkeyInput
            value={hotkey}
            onChange={setHotkey}
            netuid={netuid === '' ? undefined : Number(netuid)}
            onValidationComplete={(r) => setChainValidation(r)}
            disabled={register.isPending}
            required
          />
          {errors.hotkey && !chainValidation && (
            <p className="text-xs text-destructive -mt-3">{errors.hotkey}</p>
          )}

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes about this miner (hardware, region, role…)"
              disabled={register.isPending}
              rows={3}
              maxLength={500}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{errors.description ?? ''}</span>
              <span>{description.length}/500</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tag-input">Tags</Label>
            <div className="flex gap-2">
              <Input
                id="tag-input"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddTag()
                  }
                }}
                placeholder="e.g. gpu, h100, primary"
                disabled={register.isPending || tags.length >= 10}
                maxLength={32}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleAddTag}
                disabled={register.isPending || !tagInput.trim() || tags.length >= 10}
                aria-label="Add tag"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {tags.map((t) => (
                  <Badge key={t} variant="secondary" className="gap-1 pl-2 pr-1">
                    {t}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(t)}
                      className="hover:text-destructive"
                      aria-label={`Remove tag ${t}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            {errors.tags && <p className="text-xs text-destructive">{errors.tags}</p>}
          </div>

          {serverError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {serverError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            {onCancel && (
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                disabled={register.isPending}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={register.isPending}>
              {register.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Registering…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Register Miner
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}