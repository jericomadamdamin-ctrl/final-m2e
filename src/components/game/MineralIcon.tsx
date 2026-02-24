import bronzeIcon from '@/assets/minerals/bronze.png';
import silverIcon from '@/assets/minerals/silver.png';
import goldIcon from '@/assets/minerals/gold.png';
import ironIcon from '@/assets/minerals/iron.png';
import diamondIcon from '@/assets/minerals/diamond.png';

const MINERAL_IMAGES: Record<string, string> = {
  bronze: bronzeIcon,
  silver: silverIcon,
  gold: goldIcon,
  iron: ironIcon,
  diamond: diamondIcon,
};

interface MineralIconProps {
  icon: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const MineralIcon = ({ icon, className = '', size = 'md' }: MineralIconProps) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  const textSizes = {
    sm: 'text-sm',
    md: 'text-lg',
    lg: 'text-2xl',
  };

  // Stone uses emoji
  if (icon === 'stone') {
    return <span className={`${textSizes[size]} ${className}`}>🪨</span>;
  }

  // Check if the icon is a key in our image map
  if (MINERAL_IMAGES[icon]) {
    return (
      <img 
        src={MINERAL_IMAGES[icon]} 
        alt={icon} 
        className={`${sizeClasses[size]} object-contain ${className}`}
      />
    );
  }

  // Otherwise render as emoji
  return <span className={`${textSizes[size]} ${className}`}>{icon}</span>;
};

