// Keep observations attached to their address; never vote across IPv4/IPv6.
export function exitGroups(profile) {
  return ["ipv4", "ipv6"].map((family) => {
    const address = profile?.addresses?.[family] || "";
    const observations = (profile?.observations || []).filter((item) => address && item.ip === address);
    const countries = [...new Set(observations.map((item) => item.countryCode).filter(Boolean))];
    const places = [...new Set(observations.map((item) => item.city || item.countryCode).filter(Boolean))];
    return { family, address, observations, countries, places, conflict: countries.length > 1 };
  });
}
