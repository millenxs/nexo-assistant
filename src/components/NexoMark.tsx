import React from 'react';

export function NexoMark({
  size = 22,
  color = '#037AF6',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M23.569 3.927l-3.374 1.687c-0.623 0.308-0.973 0.903-0.973 1.631v6.293L8.029 4.109c-0.623-0.469-1.372-0.553-2.03-0.245L2.814 5.495C2.163 5.817 1.806 6.419 1.806 7.168v15.218c0 1.477 1.526 2.289 2.716 1.785l3.073-1.617c0.693-0.322 1.057-0.952 1.057-1.722v-7.7l11.732 10.591c0.602 0.546 1.421 0.679 2.086 0.364l2.786-1.505c0.602-0.315 0.938-0.931 0.938-1.68V5.614c0-1.463-1.505-2.275-2.625-1.687z"
        fill={color}
      />
    </svg>
  );
}
