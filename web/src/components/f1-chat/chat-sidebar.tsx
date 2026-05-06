"use client"

import { useEffect, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PanelLeftClose, PanelLeft, Plus, MessageSquare, X } from "lucide-react"
import { UserProfile, type UserData } from "./user-profile"

export interface ChatSession {
  id: string
  title: string
  preview: string
  timestamp: Date
  messageCount: number
}

interface ChatSidebarProps {
  sessions: ChatSession[]
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onNewChat: () => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  // Mobile drawer mode
  isMobileOpen?: boolean
  onMobileClose?: () => void
  // User auth
  user?: UserData | null
  onSignOut?: () => void
  onNavigate?: (path: string) => void
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function ChatSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  isCollapsed = false,
  onToggleCollapse,
  isMobileOpen = false,
  onMobileClose,
  user,
  onSignOut,
  onNavigate
}: ChatSidebarProps) {
  // Track if mounted to avoid hydration mismatch with timestamps
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Close mobile sidebar on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isMobileOpen && onMobileClose) {
        onMobileClose()
      }
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [isMobileOpen, onMobileClose])

  // Handle session selection on mobile - close drawer after selection
  const handleSelectSession = (id: string) => {
    onSelectSession(id)
    if (onMobileClose) onMobileClose()
  }

  const handleNewChatMobile = () => {
    onNewChat()
    if (onMobileClose) onMobileClose()
  }

  return (
    <>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={onMobileClose}
        />
      )}
      
      {/* Sidebar - hidden on mobile unless drawer is open */}
      <div 
        className={cn(
          "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-all duration-300",
          // Desktop: normal sidebar behavior
          "hidden md:flex",
          isCollapsed ? "md:w-14" : "md:w-72",
          // Mobile: slide-out drawer
          isMobileOpen && "fixed inset-y-0 left-0 z-50 flex w-72"
        )}
      >
      {/* Header */}
        <div className="shrink-0 p-3 border-b border-sidebar-border">
          <div className="flex items-center justify-between">
            {(!isCollapsed || isMobileOpen) && (
              <div className="flex items-center gap-2">
                <div className="size-7 rounded-lg bg-[#E10600] flex items-center justify-center">
                  <span className="text-white font-bold text-xs">F1</span>
                </div>
                <span className="font-semibold text-sidebar-foreground text-sm">OpenF1</span>
              </div>
            )}
            {/* Mobile: show close button, Desktop: show collapse button */}
            {isMobileOpen ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={onMobileClose}
                className="size-8 text-sidebar-foreground hover:bg-sidebar-accent md:hidden"
              >
                <X className="size-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleCollapse}
                className={cn(
                  "size-8 text-sidebar-foreground hover:bg-sidebar-accent hidden md:flex",
                  isCollapsed && "mx-auto"
                )}
              >
                {isCollapsed ? (
                  <PanelLeft className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      
      {/* New Chat Button */}
        <div className="shrink-0 p-3">
          <Button
            onClick={isMobileOpen ? handleNewChatMobile : onNewChat}
            variant="outline"
            className={cn(
              "w-full justify-start gap-2 bg-sidebar-accent/50 border-sidebar-border hover:bg-sidebar-accent text-sidebar-foreground",
              isCollapsed && !isMobileOpen && "justify-center px-0"
            )}
          >
            <Plus className="size-4" />
            {(!isCollapsed || isMobileOpen) && <span>New chat</span>}
          </Button>
        </div>
      
      {/* Sessions List */}
        <ScrollArea className="flex-1 px-2">
          <div className="space-y-1 py-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => isMobileOpen ? handleSelectSession(session.id) : onSelectSession(session.id)}
                className={cn(
                  "w-full text-left rounded-lg transition-colors group",
                  (isCollapsed && !isMobileOpen) ? "p-2 flex justify-center" : "px-3 py-2.5",
                  activeSessionId === session.id 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                    : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80"
                )}
              >
                {(isCollapsed && !isMobileOpen) ? (
                  <MessageSquare className="size-4" />
                ) : (
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className="text-sm font-medium truncate">
                        {session.title}
                      </p>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {mounted ? formatRelativeTime(session.timestamp) : ""}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {session.preview}
                    </p>
                  </div>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
      
      {/* Footer - User Profile */}
        {user && (
          <div className={cn(
            "shrink-0 border-t border-sidebar-border",
            (isCollapsed && !isMobileOpen) ? "p-2" : "p-3"
          )}>
            <UserProfile 
              user={user}
              variant={(isCollapsed && !isMobileOpen) ? "avatar-only" : "full"}
              onSignOut={onSignOut}
              onNavigate={onNavigate}
            />
            {(!isCollapsed || isMobileOpen) && (
              <p className="text-[10px] text-muted-foreground text-center mt-2">
                {sessions.length} conversation{sessions.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  )
}
