"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { CHANNELS, localISODate, type CadenceEntry, type Channel } from "@/lib/followups";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// "Log" — the full-fidelity FollowUp entry (date, channel enum, contact,
// notes). Appends one table row via /api/followups/log.
//
// Built on Radix Dialog: focus trap, scroll lock, Escape handling and the
// aria-modal wiring come from the primitive, replacing the hand-rolled
// overlay + window keydown listener this used to carry.
export function LogDialog({
  entry,
  onClose,
  onLogged,
}: {
  entry: CadenceEntry;
  onClose: () => void;
  onLogged: () => void;
}) {
  // Local day, not UTC — east of UTC toISOString() defaults to "yesterday"
  // and its max would block picking the user's actual today.
  const [date, setDate] = useState(() => localISODate());
  const [channel, setChannel] = useState<Channel>("Email");
  const [contact, setContact] = useState(entry.contacts[0]?.email ?? "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep free text single-line and pipe-free BEFORE it leaves the client
  // (the API's cell() normalizes again server-side — defense in depth): the
  // log is a pipe-delimited markdown table, so `|` and newlines would break
  // the row format.
  const tableSafe = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/\|/g, "/").trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/followups/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appNum: entry.num,
          company: entry.company,
          role: entry.role,
          date,
          channel,
          contact: tableSafe(contact),
          notes: tableSafe(notes),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "Could not log the follow-up.");
        setSaving(false);
        return;
      }
      onLogged();
      onClose();
    } catch {
      setError("Could not log the follow-up.");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Log follow-up</DialogTitle>
          <DialogDescription>
            {entry.company} · {entry.role} (#{entry.num})
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="fu-date" className="text-xs">
                Date
              </Label>
              <Input
                id="fu-date"
                type="date"
                required
                value={date}
                max={localISODate()}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fu-channel" className="text-xs">
                Channel
              </Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                <SelectTrigger id="fu-channel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="fu-contact" className="text-xs">
              Contact <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="fu-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="who you reached out to"
              list={entry.contacts.length ? `co-contacts-${entry.num}` : undefined}
            />
            {entry.contacts.length > 0 && (
              <datalist id={`co-contacts-${entry.num}`}>
                {entry.contacts.map((c) => (
                  <option key={c.email} value={c.email}>
                    {c.name ?? undefined}
                  </option>
                ))}
              </datalist>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="fu-notes" className="text-xs">
              Notes <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="fu-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="what you said, what you're waiting on…"
              className="resize-none"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-3.5 animate-spin" />} Log follow-up
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
