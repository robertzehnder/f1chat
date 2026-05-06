"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"

interface ChatInputProps {
  onSend: (message: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function ChatInput({ 
  onSend, 
  placeholder = "Ask about lap times, strategy, driver comparisons...",
  disabled = false,
  className 
}: ChatInputProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`
    }
  }, [value])
  
  const handleSubmit = () => {
    if (value.trim() && !disabled) {
      onSend(value.trim())
      setValue("")
    }
  }
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }
  
  return (
    <div className={cn("relative", className)}>
      <div className="flex items-end gap-2 bg-secondary/50 rounded-2xl border border-border/50 p-2 pl-4 backdrop-blur">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none min-h-[36px] py-2"
        />
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          className="size-9 rounded-xl bg-[#E10600] hover:bg-[#E10600]/90 shrink-0 disabled:opacity-30"
        >
          <ArrowUp className="size-4" />
          <span className="sr-only">Send message</span>
        </Button>
      </div>
    </div>
  )
}
