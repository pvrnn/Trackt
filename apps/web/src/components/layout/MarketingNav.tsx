import { Link } from '@tanstack/react-router';
import { m } from 'motion/react';
import { buttonClassName } from '../ui/Button';
import { Wordmark } from './Wordmark';

const MotionLink = m.create(Link);

const links = [
  { label: 'SELF-HOST', href: '#pillars' },
  { label: 'API', href: '/docs' },
  { label: 'GITHUB', href: 'https://github.com/pvrnn/Trackt' },
];

/** Landing navigation: wordmark, dim links, gradient SIGN IN pill. */
export function MarketingNav() {
  return (
    <nav className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-divider px-6 py-5 sm:px-10">
      <a href="/">
        <Wordmark className="text-[26px]" />
      </a>
      <span className="flex-1" />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold tracking-btn">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.href}
            className="whitespace-nowrap text-dim transition hover:text-pink"
          >
            {link.label}
          </a>
        ))}
        <MotionLink
          to="/login"
          whileTap={{ scale: 0.97 }}
          className={buttonClassName({ className: 'px-5.5 py-2.5 whitespace-nowrap' })}
        >
          SIGN IN
        </MotionLink>
      </div>
    </nav>
  );
}
