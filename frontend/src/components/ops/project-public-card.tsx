import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { patchProjectPublic, uploadPublicAsset } from '@/lib/api-ops'
import { errorMessage } from '@/lib/error-message'
import { publicAssetUrl } from '@/lib/api-public'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Props = {
  projectId: string
  isPublic: boolean
  coverAssetId: string | null
}

export function ProjectPublicCard({ projectId, isPublic, coverAssetId }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const toggle = useMutation({
    mutationFn: (next: boolean) => patchProjectPublic(projectId, { isPublic: next }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const onCover = async (file: File | undefined): Promise<void> => {
    if (!file) {
      return
    }
    try {
      await uploadPublicAsset(file, 'COVER', projectId)
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      toast.success(t('settings.saved'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('projectsPublic.title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="isPublic">{t('projectsPublic.visible')}</Label>
          <Switch
            id="isPublic"
            checked={isPublic}
            onCheckedChange={(checked) => toggle.mutate(checked)}
            disabled={toggle.isPending}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cover">{t('projectsPublic.cover')}</Label>
          <Input
            id="cover"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => void onCover(event.target.files?.[0])}
          />
          {coverAssetId ? (
            <img src={publicAssetUrl(coverAssetId)} alt="" className="h-24 w-40 rounded object-cover" />
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
