import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 5;

interface AdminPaginationProps {
    currentPage: number;
    totalItems: number;
    pageSize?: number;
    onPageChange: (page: number) => void;
    /** Optional label shown to the left, e.g. "42 results" */
    label?: string;
}

export const AdminPagination = ({
    currentPage,
    totalItems,
    pageSize = PAGE_SIZE,
    onPageChange,
    label,
}: AdminPaginationProps) => {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (totalPages <= 1) return null;

    return (
        <div className="flex items-center justify-between gap-4 py-3 px-1">
            {label ? (
                <span className="text-[9px] text-muted-foreground font-mono opacity-50 shrink-0">{label}</span>
            ) : (
                <div />
            )}
            <div className="flex items-center gap-3">
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={currentPage === 1}
                    onClick={() => onPageChange(currentPage - 1)}
                    className="h-8 w-8 p-0 rounded-xl bg-white/5 border border-white/5 disabled:opacity-20"
                >
                    <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-[10px] font-bold font-mono text-primary tabular-nums min-w-[50px] text-center">
                    {String(currentPage).padStart(2, '0')}
                    <span className="opacity-20 mx-1">/</span>
                    {String(totalPages).padStart(2, '0')}
                </span>
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={currentPage === totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                    className="h-8 w-8 p-0 rounded-xl bg-white/5 border border-white/5 disabled:opacity-20"
                >
                    <ChevronRight className="w-3.5 h-3.5" />
                </Button>
            </div>
        </div>
    );
};

/** Simple hook-like helper: paginate an array + reset page on dependency change */
export function paginate<T>(items: T[], page: number, pageSize = PAGE_SIZE): T[] {
    return items.slice((page - 1) * pageSize, page * pageSize);
}

export { PAGE_SIZE };
