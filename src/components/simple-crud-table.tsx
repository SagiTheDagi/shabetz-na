"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

interface Props {
  apiPath: string;
  idField: string;
  nameColumnLabel: string;
  idPlaceholder: string;
  idInputClassName?: string;
  namePlaceholder: string;
  addButtonLabel: string;
  confirmDelete: string;
  messages: { added: string; updated: string; deleted: string };
}

type Row = Record<string, string | number>;

export function SimpleCrudTable({
  apiPath,
  idField,
  nameColumnLabel,
  idPlaceholder,
  idInputClassName = "w-24",
  namePlaceholder,
  addButtonLabel,
  confirmDelete,
  messages,
}: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(apiPath);
    setRows(await res.json());
  }, [apiPath]);

  useEffect(() => {
    let cancelled = false;
    fetch(apiPath)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setRows(data);
      });
    return () => {
      cancelled = true;
    };
  }, [apiPath]);

  async function showError(res: Response) {
    const data = await res.json().catch(() => ({ error: "שגיאת שרת" }));
    toast.error(data.error);
  }

  async function handleAdd() {
    if (!newId.trim() || !newName.trim()) return;
    const res = await fetch(apiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        [idField]: newId.trim(),
        name: newName.trim(),
        display_order: rows.length + 1,
      }),
    });
    if (res.ok) {
      toast.success(messages.added);
      setNewId("");
      setNewName("");
      load();
    } else {
      await showError(res);
    }
  }

  async function handleUpdate(id: string) {
    const res = await fetch(`${apiPath}/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        display_order: rows.findIndex((r) => r[idField] === id) + 1,
      }),
    });
    if (res.ok) {
      toast.success(messages.updated);
      setEditingId(null);
      load();
    } else {
      await showError(res);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(confirmDelete)) return;
    const res = await fetch(`${apiPath}/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(messages.deleted);
      load();
    } else {
      await showError(res);
    }
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>קוד</TableHead>
            <TableHead>{nameColumnLabel}</TableHead>
            <TableHead className="w-32">פעולות</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const id = String(row[idField]);
            const name = String(row.name);
            return (
              <TableRow key={id}>
                <TableCell className="font-mono">{id}</TableCell>
                <TableCell>
                  {editingId === id ? (
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleUpdate(id)}
                      autoFocus
                    />
                  ) : (
                    name
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {editingId === id ? (
                      <>
                        <Button size="sm" onClick={() => handleUpdate(id)}>שמור</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>ביטול</Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(id);
                            setEditName(name);
                          }}
                        >
                          ערוך
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(id)}>
                          מחק
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="flex gap-2 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">קוד</label>
          <Input
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            placeholder={idPlaceholder}
            className={idInputClassName}
          />
        </div>
        <div className="space-y-1 flex-1">
          <label className="text-xs text-muted-foreground">שם</label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={namePlaceholder} />
        </div>
        <Button onClick={handleAdd} disabled={!newId.trim() || !newName.trim()}>
          {addButtonLabel}
        </Button>
      </div>
    </div>
  );
}
