import { useState, type ChangeEvent } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAuthMe,
  getGetAuthMeQueryKey,
  useListAdminTaxonomies,
  useCreateAdminTaxonomy,
  useUpdateAdminTaxonomy,
  useReorderAdminTaxonomies,
  getListAdminTaxonomiesQueryKey,
  getGetQuizConfigQueryKey,
  TaxonomyKind,
  AdminTaxonomy,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ChevronUp, ChevronDown, Plus, Pencil, Check, X, Tag, BarChart } from "lucide-react";

function classNames(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

export function AdminTaxonomies() {
  const { isLoaded, isSignedIn } = useAuth();
  const { data: authMe, isLoading: isLoadingAuth } = useGetAuthMe({
    query: { enabled: isLoaded && isSignedIn, queryKey: getGetAuthMeQueryKey() }
  });

  const [activeTab, setActiveTab] = useState<TaxonomyKind>("category");

  if (!isLoaded || (isSignedIn && isLoadingAuth)) {
    return <main className="mx-auto max-w-5xl p-8 text-muted-foreground animate-pulse">Loading workspace...</main>;
  }

  if (!isSignedIn) return <Redirect to="/sign-in" />;
  const permissions = authMe?.user?.permissions ?? [];
  const canManage = authMe?.user?.isSuperAdmin === true || permissions.includes("content.manage");
  
  if (!canManage) return <Redirect to="/member" />;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-primary">Taxonomy Settings</h1>
        <p className="mt-2 text-muted-foreground">Manage categories and difficulty levels used for organizing content.</p>
      </div>

      <div className="flex border-b border-border mb-6">
        <button
          className={classNames(
            "px-4 py-2 font-medium text-sm transition-colors border-b-2 flex items-center gap-2 -mb-px",
            activeTab === "category" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
          )}
          onClick={() => setActiveTab("category")}
          data-testid="button-taxonomy-categories"
        >
          <Tag className="w-4 h-4" />
          Categories
        </button>
        <button
          className={classNames(
            "px-4 py-2 font-medium text-sm transition-colors border-b-2 flex items-center gap-2 -mb-px",
            activeTab === "difficulty" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
          )}
          onClick={() => setActiveTab("difficulty")}
          data-testid="button-taxonomy-difficulties"
        >
          <BarChart className="w-4 h-4" />
          Difficulties
        </button>
      </div>

      <TaxonomyManager kind={activeTab} />
    </main>
  );
}

function TaxonomyManager({ kind }: { kind: TaxonomyKind }) {
  const { data: listData, isLoading, isError, error } = useListAdminTaxonomies({ kind });
  const taxonomies = listData?.items ?? [];

  const queryClient = useQueryClient();
  const reorderMutation = useReorderAdminTaxonomies();
  const { toast } = useToast();

  const [isAdding, setIsAdding] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === taxonomies.length - 1) return;
    setReorderError(null);

    const newItems = [...taxonomies];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newItems[index], newItems[swapIndex]] = [newItems[swapIndex], newItems[index]];

    // Optimistic update
    queryClient.setQueryData(getListAdminTaxonomiesQueryKey({ kind }), { items: newItems });

    reorderMutation.mutate(
      { data: { kind, taxonomyIds: newItems.map(t => t.id) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetQuizConfigQueryKey() });
          toast({ title: "Order saved", description: `${kind === "category" ? "Category" : "Difficulty"} order has been updated.` });
        },
        onError: (err: any) => {
          // Revert optimistic on error
          queryClient.invalidateQueries({ queryKey: getListAdminTaxonomiesQueryKey({ kind }) });
          setReorderError(err.message || "Failed to reorder items.");
        }
      }
    );
  };

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading {kind}s...</div>;
  if (isError) return <div className="py-8 text-center text-destructive bg-destructive/10 rounded-xl p-4">Failed to load {kind}s. {(error as any)?.message}</div>;

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium capitalize flex items-center gap-2">
          {kind}s
          <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium border border-border">
            {taxonomies.length}
          </span>
        </h2>
        {!isAdding && (
          <Button size="sm" onClick={() => setIsAdding(true)} className="gap-2 bg-primary hover:bg-primary/90" data-testid={`button-add-${kind}`}>
            <Plus className="w-4 h-4" />
            Add {kind}
          </Button>
        )}
      </div>

      {reorderError && (
        <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg border border-destructive/20">
          {reorderError}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-x-auto">
       <div className="min-w-[720px] flex flex-col">
        <div className="grid grid-cols-[auto_1fr_1fr_100px_120px] gap-4 p-4 border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <div className="w-16 text-center">Order</div>
          <div>Label</div>
          <div>Slug</div>
          <div className="text-center">Status</div>
          <div className="text-right">Actions</div>
        </div>

        <div className="divide-y divide-border flex-1">
          {taxonomies.length === 0 && !isAdding && (
            <div className="p-12 text-center text-muted-foreground text-sm border-2 border-dashed border-border m-4 rounded-xl">
              No {kind}s found. Add one to get started.
            </div>
          )}

          {taxonomies.map((tax, index) => (
            <TaxonomyRow
              key={tax.id}
              taxonomy={tax}
              index={index}
              isFirst={index === 0}
              isLast={index === taxonomies.length - 1}
              onMove={handleMove}
            />
          ))}

          {isAdding && (
            <TaxonomyAddRow kind={kind} onCancel={() => setIsAdding(false)} />
          )}
        </div>
       </div>
      </div>
    </div>
  );
}

function TaxonomyRow({ taxonomy, index, isFirst, isLast, onMove }: { taxonomy: AdminTaxonomy, index: number, isFirst: boolean, isLast: boolean, onMove: (index: number, dir: 'up' | 'down') => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(taxonomy.label);
  const [editSlug, setEditSlug] = useState(taxonomy.slug);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const updateMutation = useUpdateAdminTaxonomy();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSave = () => {
    if (!editLabel.trim() || !editSlug.trim()) return;
    setIsSaving(true);
    setErrorMsg(null);
    updateMutation.mutate(
      {
        taxonomyId: taxonomy.id,
        data: { label: editLabel.trim(), slug: editSlug.trim(), isActive: taxonomy.isActive }
      },
      {
        onSuccess: () => {
          setIsEditing(false);
          queryClient.invalidateQueries({ queryKey: getListAdminTaxonomiesQueryKey({ kind: taxonomy.kind }) });
          queryClient.invalidateQueries({ queryKey: getGetQuizConfigQueryKey() });
          toast({ title: "Taxonomy updated", description: `${editLabel.trim()} has been saved.` });
        },
        onError: (err: any) => {
          setErrorMsg(err.message || "Failed to update taxonomy");
        },
        onSettled: () => setIsSaving(false)
      }
    );
  };

  const toggleActive = () => {
    setIsSaving(true);
    setErrorMsg(null);
    updateMutation.mutate(
      {
        taxonomyId: taxonomy.id,
        data: { label: taxonomy.label, slug: taxonomy.slug, isActive: !taxonomy.isActive }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAdminTaxonomiesQueryKey({ kind: taxonomy.kind }) });
          queryClient.invalidateQueries({ queryKey: getGetQuizConfigQueryKey() });
          toast({
            title: taxonomy.isActive ? "Taxonomy deactivated" : "Taxonomy activated",
            description: `${taxonomy.label} ${taxonomy.isActive ? "is hidden from question dropdowns" : "is available in question dropdowns"}.`,
          });
        },
        onError: (err: any) => {
          setErrorMsg(err.message || "Failed to toggle status");
        },
        onSettled: () => setIsSaving(false)
      }
    );
  };

  if (isEditing) {
    return (
      <div className="bg-muted/10 border-l-4 border-l-primary flex flex-col">
        <div className="grid grid-cols-[auto_1fr_1fr_100px_120px] gap-4 p-3 items-center">
          <div className="w-16"></div>
          <div>
            <Input 
              value={editLabel} 
              onChange={e => setEditLabel(e.target.value)} 
              placeholder="Label" 
              aria-label={`Label for ${taxonomy.label}`}
              data-testid={`input-taxonomy-label-${taxonomy.id}`}
              className="h-9 text-sm bg-background border-border" 
              autoFocus 
            />
          </div>
          <div>
            <Input 
              value={editSlug} 
              onChange={e => setEditSlug(e.target.value)} 
              placeholder="slug-format" 
              aria-label={`Slug for ${taxonomy.label}`}
              data-testid={`input-taxonomy-slug-${taxonomy.id}`}
              className="h-9 text-sm font-mono bg-background border-border" 
            />
          </div>
          <div className="text-center">
            <span className="text-xs text-muted-foreground font-medium">
              {taxonomy.isActive ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="flex justify-end gap-1.5">
            <Button size="icon" variant="ghost" aria-label={`Cancel editing ${taxonomy.label}`} data-testid={`button-cancel-taxonomy-${taxonomy.id}`} className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" onClick={() => { setIsEditing(false); setEditLabel(taxonomy.label); setEditSlug(taxonomy.slug); setErrorMsg(null); }} disabled={isSaving}>
              <X className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label={`Save ${taxonomy.label}`} data-testid={`button-save-taxonomy-${taxonomy.id}`} className="h-9 w-9 text-primary hover:bg-primary/10 transition-colors" onClick={handleSave} disabled={isSaving || !editLabel.trim() || !editSlug.trim()}>
              <Check className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {errorMsg && (
          <div className="px-20 pb-3 text-xs text-destructive">
            {errorMsg}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col group transition-colors hover:bg-muted/10">
      <div className={classNames("grid grid-cols-[auto_1fr_1fr_100px_120px] gap-4 p-3 items-center transition-opacity", taxonomy.isActive ? "" : "opacity-60")}>
        <div className="w-16 flex flex-col items-center justify-center -space-y-1">
          <button
            onClick={() => onMove(index, 'up')}
            disabled={isFirst || isSaving}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            aria-label="Move up"
            data-testid={`button-move-up-${taxonomy.id}`}
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => onMove(index, 'down')}
            disabled={isLast || isSaving}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            aria-label="Move down"
            data-testid={`button-move-down-${taxonomy.id}`}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>

        <div className="font-medium text-sm text-foreground">{taxonomy.label}</div>
        <div className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded w-fit">{taxonomy.slug}</div>

        <div className="flex justify-center">
          <button
            onClick={toggleActive}
            disabled={isSaving}
            className={classNames(
              "px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide uppercase transition-colors border",
              taxonomy.isActive
                ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
            )}
            title={taxonomy.isActive ? "Click to deactivate" : "Click to activate"}
            aria-label={`${taxonomy.isActive ? "Deactivate" : "Activate"} ${taxonomy.label}`}
            data-testid={`button-toggle-taxonomy-${taxonomy.id}`}
          >
            {taxonomy.isActive ? "Active" : "Inactive"}
          </button>
        </div>

        <div className="flex justify-end pr-2">
          <Button size="icon" variant="ghost" aria-label={`Edit ${taxonomy.label}`} data-testid={`button-edit-taxonomy-${taxonomy.id}`} className="h-8 w-8 text-muted-foreground hover:text-primary transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => setIsEditing(true)}>
            <Pencil className="w-4 h-4" />
          </Button>
        </div>
      </div>
      {errorMsg && (
        <div className="px-20 pb-3 text-xs text-destructive">
          {errorMsg}
        </div>
      )}
    </div>
  );
}

function TaxonomyAddRow({ kind, onCancel }: { kind: TaxonomyKind, onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const createMutation = useCreateAdminTaxonomy();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // auto-generate slug for convenience
  const handleLabelChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newLabel = e.target.value;
    setLabel(newLabel);
    // Only auto-update slug if it matches the generated slug of the old label or is empty
    if (!slug || slug === label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) {
      setSlug(newLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
    }
  };

  const handleSave = () => {
    if (!label.trim() || !slug.trim()) return;
    setIsSaving(true);
    setErrorMsg(null);
    createMutation.mutate(
      {
        data: { kind, label: label.trim(), slug: slug.trim() }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAdminTaxonomiesQueryKey({ kind }) });
          queryClient.invalidateQueries({ queryKey: getGetQuizConfigQueryKey() });
          toast({ title: `${kind === "category" ? "Category" : "Difficulty"} added`, description: `${label.trim()} is now available for questions.` });
          onCancel();
        },
        onError: (err: any) => {
          setErrorMsg(err.message || "Failed to create taxonomy");
        },
        onSettled: () => setIsSaving(false)
      }
    );
  };

  return (
    <div className="flex flex-col bg-primary/5 border-l-4 border-l-primary/60">
      <div className="grid grid-cols-[auto_1fr_1fr_100px_120px] gap-4 p-3 items-center">
        <div className="w-16 flex justify-center">
          <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-bold tracking-wider">NEW</span>
        </div>
        <div>
          <Input 
            value={label} 
            onChange={handleLabelChange} 
            placeholder="Label" 
            aria-label={`New ${kind} label`}
            data-testid={`input-new-${kind}-label`}
            className="h-9 text-sm border-primary/30 focus-visible:ring-primary/50 bg-background" 
            autoFocus 
          />
        </div>
        <div>
          <Input 
            value={slug} 
            onChange={e => setSlug(e.target.value)} 
            placeholder="slug-format" 
            aria-label={`New ${kind} slug`}
            data-testid={`input-new-${kind}-slug`}
            className="h-9 text-sm font-mono border-primary/30 focus-visible:ring-primary/50 bg-background" 
          />
        </div>
        <div className="text-center">
          <span className="text-xs text-muted-foreground font-medium">Active</span>
        </div>
        <div className="flex justify-end gap-1.5">
          <Button size="icon" variant="ghost" aria-label={`Cancel adding ${kind}`} data-testid={`button-cancel-new-${kind}`} className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" onClick={onCancel} disabled={isSaving}>
            <X className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Save new ${kind}`} data-testid={`button-save-new-${kind}`} className="h-9 w-9 text-primary hover:bg-primary/20 transition-colors" onClick={handleSave} disabled={isSaving || !label.trim() || !slug.trim()}>
            <Check className="w-4 h-4" />
          </Button>
        </div>
      </div>
      {errorMsg && (
        <div className="px-20 pb-3 text-xs text-destructive">
          {errorMsg}
        </div>
      )}
    </div>
  );
}
