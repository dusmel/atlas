export { decode, htmlText, mdText, type DocText } from "./extract.ts"
export { scanDocs, type DocFile } from "./scan.ts"
export { DocIndex, folderOf, ftsPhrase, ftsQuery, MATCH_END, MATCH_START, type Counts, type DocFilters, type DocMeta, type Facets, type RepoOverview, type SearchHit, type SyncResult } from "./store.ts"
export { watchDocs } from "./watch.ts"
