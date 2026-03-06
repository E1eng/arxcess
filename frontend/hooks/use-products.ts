"use client";

import { useEffect, useState } from "react";
import { LocalProductListing, listStoredProducts, saveStoredProduct } from "@/lib/storage/marketplace";

export function useProducts() {
  const [products, setProducts] = useState<LocalProductListing[]>([]);

  useEffect(() => {
    setProducts(listStoredProducts());
  }, []);

  function addProduct(product: LocalProductListing) {
    saveStoredProduct(product);
    setProducts(listStoredProducts());
  }

  return {
    products,
    addProduct
  };
}
