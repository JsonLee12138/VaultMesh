import * as React from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "@/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn("inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground", className)} {...props} />;
}

function TabsTrigger({ className, size = "default", ...props }: React.ComponentProps<typeof TabsPrimitive.Tab> & { size?: "default" | "sm" }) {
  return <TabsPrimitive.Tab data-slot="tabs-trigger" className={cn("inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm", size === "sm" ? "h-6 px-1.5 text-xs" : "h-7 px-2 text-sm", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger };
