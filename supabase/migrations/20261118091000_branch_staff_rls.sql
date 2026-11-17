-- A branch account reads only its own staff: the people linked to the branch, plus anyone who already
-- sold on one of its invoices (so a moved employee still shows on the branch's sales and Odoo sheet).
-- Admins read everyone.
alter policy "signed-in users read employees" on public.employees
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.employee_branches eb
      where eb.employee_id = employees.id and eb.branch_id = (select private.current_branch_id()))
    or exists (
      select 1 from public.invoices i
      where i.sales_person_id = employees.id and i.branch_id = (select private.current_branch_id()))
  );
alter policy "signed-in users read employees" on public.employees rename to "read own branch staff or all as admin";

alter policy "signed-in users read employee branches" on public.employee_branches
  using ((select private.is_admin()) or branch_id = (select private.current_branch_id()));
alter policy "signed-in users read employee branches" on public.employee_branches
  rename to "read own branch staff links or all as admin";
