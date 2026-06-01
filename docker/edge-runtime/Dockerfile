# Edge runtime container that serves the existing supabase/functions/* code
# unchanged. Uses Supabase's edge-runtime image (Deno + service helpers).
FROM supabase/edge-runtime:v1.58.2

# Functions are mounted via docker-compose at /home/deno/functions
# (so updates don't require a rebuild during local dev).
ENV SUPABASE_INTERNAL_HOST_PORT=9000

EXPOSE 9000
CMD ["start", "--main-service", "/home/deno/functions/main", "-p", "9000"]
