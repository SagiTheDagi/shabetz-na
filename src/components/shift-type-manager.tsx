"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import type { ShiftType } from "@/lib/types";

export function ShiftTypeManager() {
  const [types, setTypes] = useState<ShiftType[]>([]);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    loadTypes();
  }, []);

  async function loadTypes() {
    const res = await fetch("/api/shift-types");
    setTypes(await res.json());
  }

  async function handleAdd() {
    if (!newId.trim() || !newName.trim()) return;
    const res = await fetch("/api/shift-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shift_type_id: newId.trim(),
        name: newName.trim(),
        display_order: types.length + 1,
      }),
    });
    if (res.ok) {
      toast.success("סוג משמרת נוסף");
      setNewId("");
      setNewName("");
      loadTypes();
    } else {
      const data = await res.json();
      toast.error(data.error);
    }
  }

  async function handleUpdate(id: string) {
    const res = await fetch(`/api/shift-types/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        display_order: types.findIndex((t) => t.shift_type_id === id) + 1,
      }),
    });
    if (res.ok) {
      toast.success("סוג משמרת עודכן");
      setEditingId(null);
      loadTypes();
    } else {
      const data = await res.json();
      toast.error(data.error);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק סוג משמרת זה?")) return;
    const res = await fetch(`/api/shift-types/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("סוג משמרת נמחק");
      loadTypes();
    } else {
      const data = await res.json();
      toast.error(data.error);
    }
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>קוד</TableHead>
            <TableHead>שם סוג משמרת</TableHead>
            <TableHead className="w-32">פעולות</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {types.map((type) => (
            <TableRow key={type.shift_type_id}>
              <TableCell className="font-mono">{type.shift_type_id}</TableCell>
              <TableCell>
                {editingId === type.shift_type_id ? (
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleUpdate(type.shift_type_id)}
                    autoFocus
                  />
                ) : (
                  type.name
                )}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {editingId === type.shift_type_id ? (
                    <>
                      <Button size="sm" onClick={() => handleUpdate(type.shift_type_id)}>שמור</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>ביטול</Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(type.shift_type_id);
                          setEditName(type.name);
                        }}
                      >
                        ערוך
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleDelete(type.shift_type_id)}>
                        מחק
                      </Button>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex gap-2 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">קוד</label>
          <Input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="PATROL" className="w-32" />
        </div>
        <div className="space-y-1 flex-1">
          <label className="text-xs text-muted-foreground">שם</label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="שם סוג המשמרת" />
        </div>
        <Button onClick={handleAdd} disabled={!newId.trim() || !newName.trim()}>
          הוסף סוג
        </Button>
      </div>
    </div>
  );
}
