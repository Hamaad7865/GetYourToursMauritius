import { avatar } from '@/lib/admin/dashboard';

/**
 * A guest's initials on a soft tint of their own (the hue comes from the name, so the same guest
 * keeps the same colour everywhere), which makes a list of names quick to scan. Decorative: the name
 * itself is always written beside it.
 *
 * The ink is the hue at 26% lightness on 92%: about 9:1, comfortably AA for 11px bold.
 */
export function GuestAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const { initials, hue } = avatar(name);
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-bold ${
        size === 'sm'
          ? 'h-7 w-7 text-[10.5px]'
          : size === 'lg'
            ? 'h-12 w-12 text-[15px]'
            : 'h-8 w-8 text-[11px]'
      }`}
      style={{ backgroundColor: `hsl(${hue} 55% 92%)`, color: `hsl(${hue} 50% 26%)` }}
    >
      {initials}
    </span>
  );
}
