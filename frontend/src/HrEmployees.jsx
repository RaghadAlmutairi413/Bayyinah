import { useEffect, useMemo, useState } from 'react';
import Shell, { Banner } from './Shell.jsx';
import {
  Avatar,
  EmptyState,
  Icon,
  Modal,
  TableSkeleton,
  formatDate,
  getJson,
  sendJson,
  useBanner,
} from './taskUi.jsx';
import { displayName } from './api.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


//  add a new employee
//   update an employee's information
function EmployeeForm({ employee, departments, onSubmit, onCancel }) {
  const isEdit = Boolean(employee);
  const [form, setForm] = useState(
    isEdit
      ? {
          first_name: employee.first_name,
          last_name: employee.last_name,
          job_title: employee.job_title || '',
          hire_date: employee.hire_date || '',
          department_id: String(employee.department.id),
        }
      : {
          first_name: '',
          last_name: '',
          email: '',
          role: 'Employee',
          department_id: departments.length === 1 ? String(departments[0].id) : '',
        },
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function validate() {
    if (isEdit) {
      if (!form.first_name.trim()) return 'First name is required.';
      if (!form.hire_date) return 'Hire date is required.';
    } else {
      if (!form.first_name.trim()) return 'First name is required.';
      if (!form.last_name.trim()) return 'Last name is required.';
      if (!form.email.trim()) return 'Email is required.';
      if (!EMAIL_PATTERN.test(form.email.trim())) return 'Enter a valid email address.';
    }
    if (!form.department_id) return 'Choose a department.';
    return '';
  }

  async function submit(event) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSubmit(
        isEdit
          ? {
              first_name: form.first_name.trim(),
              last_name: form.last_name.trim(),
              job_title: form.job_title.trim(),
              hire_date: form.hire_date,
              department_id: Number(form.department_id),
            }
          : {
              first_name: form.first_name.trim(),
              last_name: form.last_name.trim(),
              email: form.email.trim(),
              role: form.role,
              department_id: Number(form.department_id),
            },
      );
    } catch (failure) {
      setError(failure.message || 'The employee could not be saved.');
      setSaving(false);
    }
  }

  return (
    <form className="ws-form" onSubmit={submit} noValidate>
      {error && <div className="ws-form-error" role="alert">{error}</div>}

      {isEdit ? (
        <>
          <div className="ws-form-grid">
            <label className="ws-field">
              <span className="ws-label">First name</span>
              <input className="ws-input" value={form.first_name} maxLength={100} autoFocus onChange={(e) => setField('first_name', e.target.value)} />
            </label>
            <label className="ws-field">
              <span className="ws-label">Last name</span>
              <input className="ws-input" value={form.last_name} maxLength={100} onChange={(e) => setField('last_name', e.target.value)} />
            </label>
          </div>
          <div className="ws-form-grid">
            <label className="ws-field">
              <span className="ws-label">Job title <span className="ws-optional">(optional)</span></span>
              <input className="ws-input" value={form.job_title} maxLength={100} onChange={(e) => setField('job_title', e.target.value)} />
            </label>
            <label className="ws-field">
              <span className="ws-label">Hire date</span>
              <input className="ws-input" type="date" value={form.hire_date} onChange={(e) => setField('hire_date', e.target.value)} />
            </label>
          </div>
        </>
      ) : (
        <>
          <div className="ws-form-grid">
            <label className="ws-field">
              <span className="ws-label">First name</span>
              <input className="ws-input" value={form.first_name} maxLength={255} autoFocus onChange={(e) => setField('first_name', e.target.value)} />
            </label>
            <label className="ws-field">
              <span className="ws-label">Last name</span>
              <input className="ws-input" value={form.last_name} maxLength={255} onChange={(e) => setField('last_name', e.target.value)} />
            </label>
          </div>
          <div className="ws-form-grid">
            <label className="ws-field">
              <span className="ws-label">Email</span>
              <input className="ws-input" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
            </label>
            <label className="ws-field">
              <span className="ws-label">Role</span>
              <select className="ws-select" value={form.role} onChange={(e) => setField('role', e.target.value)}>
                <option value="Employee">Employee</option>
                <option value="Manager">Manager</option>
              </select>
            </label>
          </div>
        </>
      )}

      <label className="ws-field">
        <span className="ws-label">Department</span>
        <select className="ws-select" value={form.department_id} onChange={(e) => setField('department_id', e.target.value)}>
          <option value="">Choose a department</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>{department.name}</option>
          ))}
        </select>
      </label>

      {!isEdit && (
        <p className="ws-hint">An invitation email is sent so the new employee can set their own password.</p>
      )}

      <div className="ws-form-actions">
        <button className="ws-btn ws-btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add employee'}
        </button>
        <button className="ws-btn ws-btn-secondary" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

function EmployeesContent() {
  const { banner, success, failure, clear } = useBanner();
  const [employees, setEmployees] = useState(null); // null while loading
  const [departments, setDepartments] = useState([]);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  async function load() {
    try {
      const [people, depts] = await Promise.all([
        getJson('/api/accounts/employees/'),
        getJson('/api/accounts/departments/'),
      ]);
      setEmployees(people);
      setDepartments(depts);
    } catch (error) {
      failure(error);
      setEmployees((current) => current || []);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addEmployee(body) {
    const result = await sendJson('/api/accounts/team-invite/', 'POST', body);
    setAdding(false);
    success(result.message || 'Employee added.');
    load();
  }

  async function updateEmployee(body) {
    await sendJson(`/api/accounts/employees/${editing.id}/`, 'PATCH', body);
    setEditing(null);
    success('Employee information updated.');
    load();
  }

  // Story 7: show the employees that match the search text.
  const shown = useMemo(() => {
    const text = search.trim().toLowerCase();
    if (!text) return employees || [];
    return (employees || []).filter((person) =>
      `${displayName(person)} ${person.email} ${person.job_title || ''} ${person.department.name} ${person.role}`
        .toLowerCase()
        .includes(text),
    );
  }, [employees, search]);

  return (
    <>
      <Banner message={banner.message} isError={banner.isError} onClose={clear} />

      <div className="ws-toolbar">
        <label className="ws-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder="Search employees"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search employees"
          />
        </label>
        <button className="ws-btn ws-btn-primary" type="button" onClick={() => setAdding(true)}>
          <Icon name="plus" size={15} />
          Add employee
        </button>
      </div>

      {employees === null ? (
        <TableSkeleton />
      ) : employees.length === 0 ? (
        <div className="ws-card">
          <EmptyState icon="users" title="No employees yet">
            Add your first employee, or import a CSV file from the HR overview.
          </EmptyState>
        </div>
      ) : shown.length === 0 ? (
        <div className="ws-card">
          <EmptyState icon="search" title="No employees match your search">
            Try a different name, email, job title or department.
          </EmptyState>
        </div>
      ) : (
        <div className="ws-card ws-table-card">
          <table className="ws-table">
            <thead>
              <tr>
                <th>Name</th><th>Role</th><th>Job title</th><th>Department</th><th>Hired</th><th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((person) => (
                <tr key={person.id}>
                  <td>
                    <div className="hr-person">
                      <Avatar name={displayName(person)} size={28} />
                      <div>
                        <div className="ws-task-title">{displayName(person)}</div>
                        <div className="ws-task-sub">{person.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>{person.role}</td>
                  <td>{person.job_title || '—'}</td>
                  <td>{person.department.name}</td>
                  <td>{formatDate(person.hire_date)}</td>
                  <td>
                    <button className="ws-btn ws-btn-secondary ws-btn-sm" type="button" onClick={() => setEditing(person)}>
                      <Icon name="edit" size={13} />
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <Modal title="Add employee" onClose={() => setAdding(false)}>
          <EmployeeForm departments={departments} onSubmit={addEmployee} onCancel={() => setAdding(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${displayName(editing)}`} onClose={() => setEditing(null)}>
          <EmployeeForm employee={editing} departments={departments} onSubmit={updateEmployee} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </>
  );
}

export default function HrEmployees() {
  return (
    <Shell
      role="HR"
      title="Manage employees"
      subtitle="Add, update and search the people in your organization."
    >
      <EmployeesContent />
    </Shell>
  );
}
