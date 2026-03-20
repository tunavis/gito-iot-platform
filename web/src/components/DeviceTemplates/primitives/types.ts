export interface AnimationPrimitiveProps {
  /** 0-1 normalized intensity — maps telemetry to animation speed/magnitude */
  intensity: number;
  /** true when device offline — freezes animation */
  paused: boolean;
  /** System color (e.g. '#3b82f6' for water) */
  color: string;
}