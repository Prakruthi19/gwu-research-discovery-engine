import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Apollo Client 4 moved the React bindings to the /react subpath.
import { ApolloProvider } from "@apollo/client/react";

import { apolloClient } from "./apolloClient.js";
import App from "./App.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {/* ApolloProvider makes the client available to every useQuery below it. */}
    <ApolloProvider client={apolloClient}>
      <App />
    </ApolloProvider>
  </StrictMode>
);
