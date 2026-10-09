if type != "object" then
  error("Docker daemon configuration must be an object")
elif has("registry-mirrors") and (."registry-mirrors" | type) != "array" then
  error("Docker registry mirrors must be an array")
elif any(."registry-mirrors"[]?; type != "string" or length == 0) then
  error("Docker registry mirrors must contain nonempty strings")
else
  ."registry-mirrors" = (["https://mirror.gcr.io"] +
    ((."registry-mirrors" // []) | map(select(. != "https://mirror.gcr.io"))))
end
