# Custom edge-runtime image that adds `iputils-ping` so the `ping` monitor
# type can issue real ICMP echo requests instead of HTTP HEAD simulation.
#
# We `setcap cap_net_raw+ep` on the ping binary so the non-root `deno` user
# inside the container can open raw sockets without needing the whole
# container to run as root. The compose file additionally adds the
# NET_RAW capability so the kernel actually permits it.
FROM supabase/edge-runtime:v1.58.2

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends iputils-ping libcap2-bin \
  && setcap cap_net_raw+ep /bin/ping \
  && rm -rf /var/lib/apt/lists/*
USER deno
