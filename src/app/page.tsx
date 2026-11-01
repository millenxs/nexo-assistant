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
          if (data.employees?.[0]) {
            setCurrentEmployee(data.employees[0]);
          }
          if (data.analysts?.[0]) {
            setCurrentAnalyst(data.analysts[0]);
          }
        }
      } finally {
        setBooting(false);
      }
    };
    loadInitial();
  }, []);

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
        onBackToEmployeeView={() => {
          if (!currentEmployee && employees[0]) {
            setCurrentEmployee(employees[0]);
          }
          setView('employee');
        }}
        onLogout={() => setView('login')}
      />
    );
  }

  if (currentEmployee) {
    return (
      <EmployeeWorkspace
        employee={currentEmployee}
        allEmployees={employees}
        onSwitchEmployee={(emp) => setCurrentEmployee(emp)}
        onOpenAnalystConsole={() => {
          if (!currentAnalyst && analysts[0]) {
            setCurrentAnalyst(analysts[0]);
          }
          setView('analyst');
        }}
        onLogout={() => setView('login')}
      />
    );
  }

  return null;
}
