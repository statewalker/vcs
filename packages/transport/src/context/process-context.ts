/**
 * Ref store interface for reading and updating refs.
 *
 * Minimal interface required by the transport layer.
 * Should be implemented by the core RefStore.
 */
export interface RefStore {
  /**
   * Gets the object ID for a ref.
   * @param name - Ref name (e.g., "refs/heads/main")
   * @returns Object ID or undefined if ref doesn't exist
   */
  get(name: string): Promise<string | undefined>;

  /**
   * Updates a ref to point to a new object.
   * @param name - Ref name
   * @param oid - Object ID to set
   */
  update(name: string, oid: string): Promise<void>;

  /**
   * Lists all refs in the repository.
   * @returns Iterable of [name, oid] pairs
   */
  listAll(): Promise<Iterable<[string, string]>>;

  /**
   * Gets the target of a symbolic ref.
   * Optional method for Protocol V2 ls-refs.
   *
   * @param name - Symbolic ref name (e.g., "HEAD")
   * @returns Target ref name or undefined if not a symref
   */
  getSymrefTarget?(name: string): Promise<string | undefined>;

  /**
   * Checks if an object ID is currently a ref tip.
   * Optional method for TIP policy validation.
   *
   * @param oid - Object ID to check
   * @returns true if oid is a current ref tip
   */
  isRefTip?(oid: string): Promise<boolean>;
}
