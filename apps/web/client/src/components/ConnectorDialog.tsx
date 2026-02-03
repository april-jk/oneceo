/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * Connector configuration dialog with clean layout
 */

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Database, Globe, Mail, MessageSquare, Plus } from "lucide-react";
import { toast } from "sonner";

interface ConnectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ConnectorDialog({
  open,
  onOpenChange,
}: ConnectorDialogProps) {
  const connectors = [
    {
      icon: Database,
      name: "Database",
      description: "Connect to your database",
      color: "bg-blue-500",
    },
    {
      icon: Globe,
      name: "API",
      description: "Integrate external APIs",
      color: "bg-green-500",
    },
    {
      icon: Mail,
      name: "Email",
      description: "Send and receive emails",
      color: "bg-purple-500",
    },
    {
      icon: MessageSquare,
      name: "Slack",
      description: "Connect to Slack workspace",
      color: "bg-pink-500",
    },
  ];

  const handleConnect = (name: string) => {
    toast.success(`${name} connector configured`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">
            Configure Connectors
          </DialogTitle>
          <DialogDescription className="text-base">
            Connect your AI agent to external services and data sources
          </DialogDescription>
        </DialogHeader>

        <Separator className="my-4" />

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 pr-4">
            {/* Available Connectors */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Available Connectors
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {connectors.map((connector) => {
                  const Icon = connector.icon;
                  return (
                    <div
                      key={connector.name}
                      className="group p-4 border border-border rounded-xl hover:border-primary/30 hover:shadow-md transition-all duration-200 cursor-pointer bg-card"
                      onClick={() => handleConnect(connector.name)}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-10 h-10 ${connector.color} rounded-lg flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-200`}
                        >
                          <Icon className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm text-card-foreground">
                            {connector.name}
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1">
                            {connector.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <Separator className="my-6" />

            {/* Custom Connector */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Custom Connector
              </h3>
              <div className="space-y-4 p-4 border border-border rounded-xl bg-card">
                <div className="space-y-2">
                  <Label htmlFor="connector-name" className="text-sm font-medium">
                    Connector Name
                  </Label>
                  <Input
                    id="connector-name"
                    placeholder="Enter connector name"
                    className="rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="connector-url" className="text-sm font-medium">
                    API Endpoint
                  </Label>
                  <Input
                    id="connector-url"
                    placeholder="https://api.example.com"
                    className="rounded-lg"
                  />
                </div>
                <Button
                  className="w-full rounded-lg gap-2"
                  onClick={() => handleConnect("Custom")}
                >
                  <Plus className="w-4 h-4" />
                  Add Custom Connector
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
