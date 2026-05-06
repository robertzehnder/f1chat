"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { 
  User, 
  Settings, 
  HelpCircle, 
  LogOut,
  Bell,
  Star,
  CreditCard
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface UserData {
  name: string
  email: string
  avatar?: string
  initials: string
  plan?: "free" | "pro" | "team"
}

interface UserProfileProps {
  user: UserData
  variant?: "full" | "compact" | "avatar-only"
  className?: string
  onSignOut?: () => void
  onNavigate?: (path: string) => void
}

export function UserProfile({ 
  user, 
  variant = "full",
  className,
  onSignOut,
  onNavigate
}: UserProfileProps) {
  const planLabel = {
    free: "Free",
    pro: "Pro",
    team: "Team"
  }
  
  const planColor = {
    free: "text-muted-foreground",
    pro: "text-[#E10600]",
    team: "text-[#E10600]"
  }
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button 
          className={cn(
            "flex items-center gap-3 rounded-lg transition-colors outline-none",
            variant === "full" && "w-full p-2 hover:bg-sidebar-accent text-left",
            variant === "compact" && "p-1.5 hover:bg-secondary rounded-full",
            variant === "avatar-only" && "p-0",
            className
          )}
        >
          <Avatar className={cn(
            "border-2 border-border/50",
            variant === "avatar-only" ? "size-8" : "size-9"
          )}>
            {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
            <AvatarFallback className="bg-[#E10600]/10 text-[#E10600] font-semibold text-sm">
              {user.initials}
            </AvatarFallback>
          </Avatar>
          
          {variant === "full" && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {user.name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {user.email}
              </p>
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent 
        align="end" 
        className="w-64 bg-card border-border"
        sideOffset={8}
      >
        {/* User Info Header */}
        <div className="px-3 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <Avatar className="size-10 border-2 border-border/50">
              {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
              <AvatarFallback className="bg-[#E10600]/10 text-[#E10600] font-semibold">
                {user.initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {user.name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {user.email}
              </p>
            </div>
          </div>
          {user.plan && (
            <div className="mt-2 flex items-center gap-1.5">
              <Star className={cn("size-3.5", planColor[user.plan])} />
              <span className={cn("text-xs font-medium", planColor[user.plan])}>
                {planLabel[user.plan]} Plan
              </span>
            </div>
          )}
        </div>
        
        <DropdownMenuGroup className="py-1">
          <DropdownMenuItem 
            onClick={() => onNavigate?.("/profile")}
            className="cursor-pointer"
          >
            <User className="size-4" />
            <span>Profile</span>
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={() => onNavigate?.("/settings")}
            className="cursor-pointer"
          >
            <Settings className="size-4" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={() => onNavigate?.("/notifications")}
            className="cursor-pointer"
          >
            <Bell className="size-4" />
            <span>Notifications</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        
        <DropdownMenuSeparator />
        
        <DropdownMenuGroup className="py-1">
          <DropdownMenuItem 
            onClick={() => onNavigate?.("/billing")}
            className="cursor-pointer"
          >
            <CreditCard className="size-4" />
            <span>Billing</span>
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={() => onNavigate?.("/help")}
            className="cursor-pointer"
          >
            <HelpCircle className="size-4" />
            <span>Help & Support</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        
        <DropdownMenuSeparator />
        
        <DropdownMenuItem 
          onClick={onSignOut}
          variant="destructive"
          className="cursor-pointer"
        >
          <LogOut className="size-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
