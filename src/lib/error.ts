export const getErrorMessage = (err: unknown, fallback = 'Something went wrong') => {
  if (!err) return fallback;

  if (typeof err === 'string') return err;

  if (err instanceof Error) {
    if (err.message === 'Failed to fetch') return 'Network error. Please check your connection.';
    return err.message || fallback;
  }

  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }

  return fallback;
};
