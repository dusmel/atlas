export { decode, htmlText, mdText, tagList, type DocText } from "./extract.ts"
export { scanDocs, type DocFile } from "./scan.ts"
export { DocIndex, folderOf, ftsPhrase, ftsQuery, LOW_WEIGHT_FOLDERS, lowWeight, MATCH_END, MATCH_START, NO_TYPE, type Counts, type DocFilters, type DocMeta, type DocRow, type Facets, type RepoOverview, type SearchHit, type SyncResult } from "./store.ts"
export { watchDocs } from "./watch.ts"
