import { useMutation, useQueryClient } from "@tanstack/react-query"
import { GlobeIcon, LinkIcon } from "lucide-react"
import { toast } from "sonner"
import { copy } from "@/components/todos/copy-id"
import { Button } from "@/components/ui/button"
import { api, send } from "@/lib/api"
import type { Share } from "@/lib/docs"

export const shareUrl = (s: Pick<Share, "token">) => `${window.location.origin}/s/${s.token}`

/** Creates the doc's share (or finds the live one), copies its link and says so. */
export function useMakePublic(repo: string, path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<Share>("/shares", send("POST", { repo, path })),
    onSuccess: (s) => {
      void copy(shareUrl(s), "Public link copied")
      void qc.invalidateQueries({ queryKey: ["doc", repo, path] })
      void qc.invalidateQueries({ queryKey: ["shares"] })
    },
    onError: (e) => toast.error("Could not make it public", { description: (e as Error).message }),
  })
}

/** Make public. Once shared, it copies the link again. */
export function ShareButton({ repo, path, share, size = "sm" }: { repo: string; path: string; share: Share | null; size?: "sm" | "icon-sm" }) {
  const make = useMakePublic(repo, path)
  if (share) {
    return (
      <Button variant="outline" size={size} onClick={() => void copy(shareUrl(share), "Public link copied")} title="Anyone with the link can read this doc. Revoke it on Shared.">
        <LinkIcon data-icon="inline-start" />
        Copy public link
      </Button>
    )
  }
  return (
    <Button variant="outline" size={size} disabled={make.isPending} onClick={() => make.mutate()} title="Anyone with the link can read it, without logging in, and its scripts never run">
      <GlobeIcon data-icon="inline-start" />
      Make public
    </Button>
  )
}
