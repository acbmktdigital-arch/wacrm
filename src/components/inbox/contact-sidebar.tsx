"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES,
} from "@/lib/storage/upload-media";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Paperclip,
  FileText,
  Download,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [newNoteFile, setNewNoteFile] = useState<File | null>(null);
  const [addingNote, setAddingNote] = useState(false);
  const noteFileInputRef = useRef<HTMLInputElement>(null);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || (!newNote.trim() && !newNoteFile)) return;
    if (!accountId) return;
    if (newNoteFile && newNoteFile.size > MEDIA_MAX_BYTES) {
      toast.error(tSidebar("fileTooLarge"));
      return;
    }
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    // Upload the attachment first (if any); abort the note on failure so
    // we never store a row pointing at a missing file.
    let filePath: string | null = null;
    let fileMeta: { name: string; type: string; size: number } | null = null;
    if (newNoteFile) {
      try {
        const { path } = await uploadAccountMedia("contact-files", newNoteFile);
        filePath = path;
        fileMeta = {
          name: newNoteFile.name,
          type: newNoteFile.type || "application/octet-stream",
          size: newNoteFile.size,
        };
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : tSidebar("uploadFailed"),
        );
        setAddingNote(false);
        return;
      }
    }

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim() || null,
        file_path: filePath,
        file_name: fileMeta?.name ?? null,
        file_type: fileMeta?.type ?? null,
        file_size: fileMeta?.size ?? null,
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
      setNewNoteFile(null);
      if (noteFileInputRef.current) noteFileInputRef.current.value = "";
    } else if (error) {
      if (filePath)
        void deleteAccountMedia("contact-files", filePath).catch(() => {});
      toast.error(tSidebar("uploadFailed"));
    }
    setAddingNote(false);
  }, [contact, newNote, newNoteFile, accountId, tSidebar]);

  // Private bucket → mint a short-lived signed URL on demand and open it.
  const openNoteFile = useCallback(async (note: ContactNote) => {
    if (!note.file_path) return;
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("contact-files")
      .createSignedUrl(note.file_path, 120);
    if (error || !data?.signedUrl) {
      toast.error(tSidebar("downloadFailed"));
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }, [tSidebar]);

  function formatFileSize(bytes?: number | null): string {
    if (!bytes || bytes <= 0) return "";
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={(!newNote.trim() && !newNoteFile) || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              {/* Attach control + selected-file preview */}
              <input
                ref={noteFileInputRef}
                type="file"
                onChange={(e) => setNewNoteFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              {newNoteFile ? (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-2 py-1.5 text-[11px]">
                  <FileText className="size-3.5 shrink-0 text-primary" />
                  <span
                    className="flex-1 truncate text-foreground"
                    title={newNoteFile.name}
                  >
                    {newNoteFile.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatFileSize(newNoteFile.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setNewNoteFile(null);
                      if (noteFileInputRef.current)
                        noteFileInputRef.current.value = "";
                    }}
                    className="shrink-0 text-muted-foreground hover:text-red-400"
                    aria-label={tSidebar("removeFile")}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => noteFileInputRef.current?.click()}
                  className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Paperclip className="size-3" />
                  {tSidebar("attach")}
                </button>
              )}

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    {note.note_text && (
                      <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                        {note.note_text}
                      </p>
                    )}
                    {note.file_path && (
                      <button
                        type="button"
                        onClick={() => openNoteFile(note)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-left text-[11px] transition-colors hover:border-primary/40 hover:bg-muted",
                          note.note_text && "mt-1.5",
                        )}
                      >
                        <FileText className="size-3.5 shrink-0 text-primary" />
                        <span
                          className="flex-1 truncate text-foreground"
                          title={note.file_name ?? undefined}
                        >
                          {note.file_name ?? tSidebar("attachment")}
                        </span>
                        {note.file_size ? (
                          <span className="shrink-0 text-muted-foreground">
                            {formatFileSize(note.file_size)}
                          </span>
                        ) : null}
                        <Download className="size-3 shrink-0 text-muted-foreground" />
                      </button>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
