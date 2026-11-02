'use client';

import React, { useEffect, useState } from 'react';
import { Analyst, Employee } from '@/domain/types';
import { LoginView } from '@/components/LoginView';
import { EmployeeWorkspace } from '@/components/EmployeeWorkspace';
import { AnalystConsole } from '@/components/AnalystConsole';

export default function HomePage() {
  const [view, setView] = useState<'login' | 'employee' | 'analyst'>('login');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [analysts, setAnalysts] = useState<Analyst[]>([]);
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(null);
  const [currentAnalyst, setCurrentAnalyst] = useState<Analyst | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const loadInitial = async () => {
      try {
        const res = await fetch('/api/auth');
        const data = await res.json();
        if (res.ok) {
          setEmployees(data.employees || []);
          setAnalysts(data.analysts || []);

          if (data.activeSession?.role === 'employee' && data.activeSession.employee) {
            setCurrentEmployee(data.activeSession.employee);
            setView('employee');
          } else if (data.activeSession?.role === 'analyst' && data.activeSession.analyst) {
            setCurrentAnalyst(data.activeSession.analyst);
            setView('analyst');
          } else {
            if (data.employees?.[0]) setCurrentEmployee(data.employees[0]);
            if (data.analysts?.[0]) setCurrentAnalyst(data.analysts[0]);
          }
        }
      } finally {
        setBooting(false);
      }
    };
    loadInitial();
  }, []);

  const establishServerSessionByEmail = async (email: string) => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'demo-session-switch' }),
    });
    const data = await res.json();
    if (!res.ok) return;

    if (data.role === 'employee') {
      setCurrentEmployee(data.employee);
      setView('employee');
    } else if (data.role === 'analyst') {
      setCurrentAnalyst(data.analyst);
      setView('analyst');
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    setView('login');
  };

  if (booting) {
    return (
      <div className="min-h-screen w-full bg-[var(--paper)] flex items-center justify-center text-[14px] text-[var(--ink-3)]">
        Inicializando Nexo Assist…
      </div>
    );
  }

  if (view === 'login') {
    return (
      <LoginView
        employees={employees}
        analysts={analysts}
        onLoginEmployee={(emp) => {
          setCurrentEmployee(emp);
          setView('employee');
        }}
        onLoginAnalyst={(an) => {
          setCurrentAnalyst(an);
          setView('analyst');
        }}
      />
    );
  }

  if (view === 'analyst' && currentAnalyst) {
    return (
      <AnalystConsole
        analyst={currentAnalyst}
        onLogout={handleLogout}
      />
    );
  }

  if (currentEmployee) {
    return (
      <EmployeeWorkspace
        employee={currentEmployee}
        onLogout={handleLogout}
      />
    );
  }

  return null;
}
