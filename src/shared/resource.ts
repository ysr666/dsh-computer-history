export type ResourceKind =
  | 'file'
  | 'directory'
  | 'url'
  | 'document'
  | 'workspace'

export interface ResourceIdentity {
  readonly kind: ResourceKind
  readonly canonicalUri: string
  readonly displayLabel?: string
}
