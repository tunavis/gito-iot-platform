interface LoadingStateProps {
  message?: string;
  skeleton?: boolean;
  skeletonCount?: number;
}

function SkeletonCard() {
  return (
    <div className="bg-surface rounded-lg border border-th-default shadow-sm p-6 animate-pulse">
      <div className="h-4 bg-panel rounded w-1/3 mb-4" />
      <div className="h-8 bg-panel rounded w-1/2" />
    </div>
  );
}

export default function LoadingState({ message, skeleton, skeletonCount = 4 }: LoadingStateProps) {
  if (skeleton) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: skeletonCount }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="w-10 h-10 border-4 border-th-default border-t-primary-600 rounded-full animate-spin mb-4" />
      {message && <p className="text-sm text-th-secondary">{message}</p>}
    </div>
  );
}
