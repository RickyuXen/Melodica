import { Volume2 } from "lucide-react";

type VolumeSliderProps = {
  value: number;
  onChange: (volume: number) => void;
  disabled?: boolean;
};

export function VolumeSlider({
  value,
  onChange,
  disabled = false,
}: VolumeSliderProps) {
  return (
    <label className="volume-control">
      <Volume2 className="volume-icon" />
      <input
        type="range"
        className="volume-slider"
        min={0}
        max={1}
        step={0.01}
        value={value}
        disabled={disabled}
        aria-label="Volume"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
