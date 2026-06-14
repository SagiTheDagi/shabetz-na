"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import type { Rank } from "@/lib/types";

export function RankManager() {
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    loadRanks();
  }, []);

  async function loadRanks() {
    const res = await fetch("/api/ranks");
    setRanks(await res.json());
  }

  async function handleAdd() {
    if (!newId.trim() || !newName.trim()) return;
    const res = await fetch("/api/ranks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rank_id: newId.trim(),
        name: newName.trim(),
        display_order: ranks.length + 1,
      }),
    });
    if (res.ok) {
      toast.success("דרגה נוספה");
      setNewId("");
      setNewName("");
      loadRanks();
    } else {
      const data = await res.json();
      toast.error(data.error);
    }
  }

  async function handleUpdate(rankId: string) {
    const res = await fetch(`/api/ranks/${rankId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        display_order: ranks.findIndex((r) => r.rank_id === rankId) + 1,
      }),
    });
    if (res.ok) {
      toast.success("דרגה עודכנה");
      setEditingId(null);
      loadRanks();
    } else {
      const data = await res.json();
      toast.error(data.error);
    }
  }

  async function handleDelete(rankId: string) {
    if (!confirm("למחוק דרגה זו?")) return;
    const res = await fetch(`/api/ranks/${rankId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("דרגה נמחקה");
      loadRanks();
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
            <TableHead>שם דרגה</TableHead>
            <TableHead className="w-32">פעולות</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ranks.map((rank) => (
            <TableRow key={rank.rank_id}>
              <TableCell className="font-mono">{rank.rank_id}</TableCell>
              <TableCell>
                {editingId === rank.rank_id ? (
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleUpdate(rank.rank_id)}
                    autoFocus
                  />
                ) : (
                  rank.name
                )}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {editingId === rank.rank_id ? (
                    <>
                      <Button size="sm" onClick={() => handleUpdate(rank.rank_id)}>שמור</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>ביטול</Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(rank.rank_id);
                          setEditName(rank.name);
                        }}
                      >
                        ערוך
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleDelete(rank.rank_id)}>
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

      {/* Add new */}
      <div className="flex gap-2 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">קוד</label>
          <Input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="OL5" className="w-24" />
        </div>
        <div className="space-y-1 flex-1">
          <label className="text-xs text-muted-foreground">שם</label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="שם הדרגה" />
        </div>
        <Button onClick={handleAdd} disabled={!newId.trim() || !newName.trim()}>
          הוסף דרגה
        </Button>
      </div>
    </div>
  );
}
