import { useQuery } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";

export const infractionKeys = {
  all: ["infractions"],
  catalogue: (filters) => [...infractionKeys.all, "catalogue", filters],
};

export function useInfractionCatalogue(filters) {
  return useQuery({
    queryKey: infractionKeys.catalogue(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.infractions.catalogue(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
    staleTime: 15 * 60 * 1000, // Catalogue is mostly static
  });
}
