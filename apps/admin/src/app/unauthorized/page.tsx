export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-8 h-8 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">
          Access Denied
        </h1>
        <p className="text-gray-400 mb-6">
          You do not have permission to access the admin dashboard.
          If you believe this is an error, contact a super administrator.
        </p>
        <a
          href="/login"
          className="inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium bg-gray-800 hover:bg-gray-700 text-white transition-colors"
        >
          Return to Login
        </a>
      </div>
    </div>
  )
}
