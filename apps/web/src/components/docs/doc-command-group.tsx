import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { FileTextIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { CommandGroup, CommandItem } from "@/components/ui/command"
import { api } from "@/lib/api"
import { docKey, type Hit } from "@/lib/docs"

/**
 * Docs matching what is typed in a command palette, from the server's search. Each item's value
 * holds the typed text, so cmdk's own filter keeps it and doesn't show "Nothing matches" beside it.
 */
export function DocCommandGroup({ query, onPick }: { query: string; onPick: (hit: Hit) => void }) {
  const [q, setQ] = useState(query)
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 150)
    return () => clearTimeout(t)
  }, [query])
  const found = useQuery({
    queryKey: ["palette-docs", q],
    queryFn: () => api<{ results: Hit[] }>(`/search?${new URLSearchParams({ q, limit: "6" })}`),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
  })
  const hits = q.length >= 2 ? (found.data?.results ?? []) : []
  if (!hits.length) return null
  return (
    <CommandGroup heading="Docs">
      {hits.map((h) => (
        <CommandItem key={docKey(h)} value={`${query} ${docKey(h)}`} onSelect={() => onPick(h)}>
          <FileTextIcon />
          <span className="min-w-0 flex-1 truncate">{h.title}</span>
          <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground" translate="no">
            {h.repo}/{h.path}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
