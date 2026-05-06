import { cn } from "@/lib/utils"

interface MessageBubbleProps {
  content: string
  className?: string
}

export function MessageBubble({ content, className }: MessageBubbleProps) {
  return (
    <div className={cn(
      "bg-secondary/50 rounded-2xl rounded-br-md px-3 md:px-4 py-2.5 md:py-3 max-w-[90%] md:max-w-[85%] ml-auto",
      className
    )}>
      <p className="text-[13px] md:text-sm text-foreground leading-relaxed">{content}</p>
    </div>
  )
}
