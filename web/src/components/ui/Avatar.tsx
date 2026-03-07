interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: { box: 'w-7 h-7', text: 'text-[11px]', radius: '0.5rem' },
  md: { box: 'w-9 h-9', text: 'text-[13px]', radius: '0.625rem' },
  lg: { box: 'w-11 h-11', text: 'text-sm',   radius: '0.75rem' },
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({ name, size = 'md', className = '' }: AvatarProps) {
  const s = sizes[size];
  return (
    <div
      className={`${s.box} ${s.text} ${className} flex items-center justify-center flex-shrink-0 font-bold text-white select-none`}
      style={{
        background:   'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
        borderRadius: s.radius,
      }}
      aria-label={name}
    >
      {getInitials(name)}
    </div>
  );
}
