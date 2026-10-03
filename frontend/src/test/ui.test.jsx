import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Field, Input, Button } from '../components/ui/Controls.jsx';
import { Modal } from '../components/ui/Overlay.jsx';
import DataTable from '../components/ui/DataTable.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import PasswordStrength from '../components/ui/PasswordStrength.jsx';
import { Badge } from '../components/ui/Feedback.jsx';

describe('Field accessibility wiring', () => {
  it('associates label, hint and error with the control (render-function form)', () => {
    render(<Field label="Email" hint="We never share it" error="Enter a valid email" required>{(p) => <Input {...p} />}</Field>);
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    const err = screen.getByRole('alert');
    expect(err).toHaveTextContent('Enter a valid email');
    expect(input.getAttribute('aria-describedby')).toContain(err.id);
  });
  it('also wires a single element child', () => {
    render(<Field label="Authenticator code"><Input /></Field>);
    expect(screen.getByLabelText('Authenticator code')).toBeInTheDocument();
  });
  it('shows the hint only when there is no error', () => {
    const { rerender } = render(<Field label="Name" hint="As on your ID">{(p) => <Input {...p} />}</Field>);
    expect(screen.getByText('As on your ID')).toBeInTheDocument();
    rerender(<Field label="Name" hint="As on your ID" error="Required">{(p) => <Input {...p} />}</Field>);
    expect(screen.queryByText('As on your ID')).not.toBeInTheDocument();
  });
});

describe('Modal', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (<><button onClick={() => setOpen(true)}>Open</button><Modal open={open} onClose={() => setOpen(false)} title="Confirm thing"><input aria-label="inside" /></Modal></>);
  }
  it('is an accessible dialog, closes on Escape and restores focus', () => {
    render(<Harness />);
    const trigger = screen.getByText('Open');
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Confirm thing' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.body.classList.contains('no-scroll')).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.classList.contains('no-scroll')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
  it('traps Tab focus inside the dialog', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open'));
    const buttons = screen.getAllByRole('button');
    const last = screen.getByLabelText('inside');
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    expect(buttons.length).toBeGreaterThan(0);
  });
});

describe('DataTable', () => {
  const rows = [{ id: 1, name: 'Ana', amount: '$5.00' }];
  const columns = [{ key: 'name', header: 'Name' }, { key: 'amount', header: 'Amount' }];
  it('labels cells for the stacked mobile layout', () => {
    render(<DataTable rows={rows} columns={columns} caption="People" />);
    expect(screen.getByText('Ana').closest('td')).toHaveAttribute('data-label', 'Name');
  });
  it('activates clickable rows from the keyboard', () => {
    const onRowClick = vi.fn();
    render(<DataTable rows={rows} columns={columns} onRowClick={onRowClick} />);
    const row = screen.getByText('Ana').closest('tr');
    expect(row).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
  it('renders the empty state', () => {
    render(<DataTable rows={[]} columns={columns} empty={<p>Nothing here</p>} />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});

describe('ErrorBoundary', () => {
  it('shows a friendly recovery state instead of a blank page', () => {
    const Boom = () => { throw new Error('kaboom'); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText(/kaboom/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('misc components', () => {
  it('PasswordStrength announces unmet requirements to screen readers', () => {
    render(<PasswordStrength password="abc" />);
    expect(screen.getAllByText(/\(not met\)/).length).toBeGreaterThan(3);
    expect(screen.getByRole('img', { name: /Password strength: Weak/ })).toBeInTheDocument();
  });
  it('Badge never relies on colour alone: it always has text', () => {
    render(<Badge status="additional_verification_required" />);
    expect(screen.getByText('Verification required')).toBeInTheDocument();
  });
  it('Button exposes loading state and prevents double submission', () => {
    const onClick = vi.fn();
    render(<MemoryRouter><Button loading onClick={onClick}>Save</Button></MemoryRouter>);
    const b = screen.getByRole('button', { name: /Save/ });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
});
