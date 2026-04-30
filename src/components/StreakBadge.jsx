import { Flame, TrendingDown } from 'lucide-react';

export default function StreakBadge({ streaks }) {
  const { current, currentType, bestWin, worstLoss } = streaks;
  const isWin = currentType === 'win';
  const Icon = isWin ? Flame : TrendingDown;
  const color = isWin ? 'text-accent-green' : currentType === 'loss' ? 'text-accent-red' : 'text-text-secondary';

  return (
    <div className="card px-4 py-3 flex items-center gap-4">
      <div className={`p-2 rounded ${isWin ? 'bg-accent-green/10' : currentType === 'loss' ? 'bg-accent-red/10' : 'bg-bg-hover'}`}>
        <Icon size={18} className={color} />
      </div>
      <div className="flex-1">
        <div className="stat-label">Current Streak</div>
        <div className={`text-xl font-semibold font-mono ${color}`}>
          {current > 0 ? `${current} ${isWin ? 'W' : 'L'}` : '—'}
        </div>
      </div>
      <div className="text-right text-xs text-text-secondary leading-tight">
        <div>Best <span className="font-mono text-accent-green">{bestWin}W</span></div>
        <div>Worst <span className="font-mono text-accent-red">{worstLoss}L</span></div>
      </div>
    </div>
  );
}
