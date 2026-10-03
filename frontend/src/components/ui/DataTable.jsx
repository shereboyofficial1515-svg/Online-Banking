/**
 * Responsive table: a real <table> on wide screens; on phones each row becomes a labelled card (via data-label),
 * so there is never horizontal scrolling. Rows can be activated by mouse or keyboard when onRowClick is set.
 */
export default function DataTable({ columns, rows, rowKey = (r) => r.id, onRowClick, caption, empty }) {
  if (!rows.length && empty) return empty;
  return (
    <div className="table-wrap">
      <table className="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.className}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className={onRowClick ? 'clickable' : ''} tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(r); } } : undefined}>
              {columns.map((c) => <td key={c.key} data-label={c.header} className={c.className}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
