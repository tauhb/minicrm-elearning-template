import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import CourseList from './CourseList'
import CourseEditor from './CourseEditor'
import DigitalProducts from './DigitalProducts'
import AllProductsView from './AllProductsView'

// Post-unification: user always lands on AllProductsView which unifies both tables
// into one grid. The old per-table views are still routable as internal editors —
// clicking a card in AllProductsView jumps to /admin/products/{courses|digital}/...
// which is where the "rich editor" for that source lives.
const ProductsLayout: React.FC = () => (
  <div className="h-full">
    <Routes>
      <Route index element={<AllProductsView />} />
      <Route path="courses" element={<CourseList />} />
      <Route path="courses/:courseId" element={<CourseEditor />} />
      <Route path="digital" element={<DigitalProducts />} />
    </Routes>
  </div>
)
export default ProductsLayout
