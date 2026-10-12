import { Link } from "@tanstack/react-router"
import { GlobeIcon, KeyboardIcon, LogOutIcon, MonitorIcon, MoonIcon, SearchIcon, SettingsIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { DocsSourcePill } from "@/components/docs/source-pill"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd, KbdGroup } from "@/components/ui/kbd"

// `wide` items move into the account menu on a phone, so the header fits 390 px.
const NAV = [
  { to: "/todos", label: "Todos", wide: false },
  { to: "/docs", label: "Docs", wide: false },
  { to: "/shared", label: "Shared", wide: true },
  { to: "/settings", label: "Settings", wide: true },
] as const

/** The header on every page. */
export function AppHeader({ onCommand, onShortcuts }: { onCommand?: () => void; onShortcuts?: () => void }) {
  const { theme, setTheme } = useTheme()
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur supports-backdrop-filter:bg-background/80 sm:gap-4 sm:px-6">
      <Link to="/todos" aria-label="Atlas" className="mr-1 flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight">
        <img src="/icon.png" alt="" width={24} height={24} className="size-6" />
        {/* On a phone the icon alone leaves room for the docs pill. */}
        <span className="hidden sm:inline">Atlas</span>
      </Link>
      <nav aria-label="Main" className="flex items-center gap-1">
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className={cn("rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", n.wide && "max-sm:hidden")}
            activeProps={{ className: "bg-accent text-foreground font-medium" }}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
        <DocsSourcePill />
        {onCommand && (
          <Button variant="outline" onClick={onCommand} className="h-9 gap-2 text-muted-foreground sm:w-60 sm:justify-start" aria-label="Open the command palette">
            <SearchIcon data-icon="inline-start" />
            <span className="hidden sm:inline">Find or run a command…</span>
            <KbdGroup className="ml-auto hidden sm:inline-flex">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </Button>
        )}
        {onShortcuts && (
          <Button variant="ghost" size="icon" className="hidden size-9 sm:inline-flex" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={onShortcuts}>
            <KeyboardIcon />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9" aria-label="Menu: theme, pages and log out">
              <SunIcon className="dark:hidden" />
              <MoonIcon className="hidden dark:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
                <DropdownMenuRadioItem value="light">
                  <SunIcon />
                  Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <MoonIcon />
                  Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  <MonitorIcon />
                  System
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup className="sm:hidden">
              <DropdownMenuItem asChild>
                <Link to="/shared">
                  <GlobeIcon />
                  Shared
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings">
                  <SettingsIcon />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </DropdownMenuGroup>
            <DropdownMenuGroup>
              <form method="post" action="/logout">
                <DropdownMenuItem asChild>
                  <button type="submit" className="w-full">
                    <LogOutIcon />
                    Log out
                  </button>
                </DropdownMenuItem>
              </form>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

