// The Apollo Client instance — the browser's connection to our GraphQL API.
//
// Teaching note: this is the ONLY place the client knows a server URL. Every
// component just calls useQuery/useMutation with a gql document; Apollo
// handles the HTTP, caching, and re-rendering.
import { ApolloClient, InMemoryCache, HttpLink } from "@apollo/client";

export const apolloClient = new ApolloClient({
  link: new HttpLink({
    // Override via client/.env -> VITE_GRAPHQL_URL for other environments.
    uri: import.meta.env.VITE_GRAPHQL_URL || "http://localhost:4000/",
  }),
  cache: new InMemoryCache(),
});
