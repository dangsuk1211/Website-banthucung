const router = require('express').Router();

const UserModel     = require('../models/user');
const bcrypt        = require('bcryptjs');
const Passport      = require('../modules/passport');
const CategoryModel = require('../models/category');
const ProductModel  = require('../models/product');
const OrderModel    = require('../models/order');
const OrderStatus   = require('../constants/order-status');
const ShoppingCart  = require('../modules/shopping-cart');
const moment        = require('moment');

// Middleware bảo vệ route yêu cầu đăng nhập
function ensureLoggedIn(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/dang-nhap.html?returnUrl=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

// Lấy giỏ hàng từ session
function getShoppingCart(req) {
  if (req.session.cart) {
    return { hasExisted: true, cart: new ShoppingCart(req.session.cart) };
  }
  return { hasExisted: false, cart: new ShoppingCart({ items: {} }) };
}

// Map trạng thái đơn thành nhãn hiển thị
const statusLabels = {
  [OrderStatus.submit]:    'Đang chuẩn bị hàng',
  [OrderStatus.shipping]:  'Đang vận chuyển',
  [OrderStatus.completed]: 'Hoàn tất',
  [OrderStatus.cancelled]: 'Đã hủy'
};

// ===================== SITE ROUTES =====================

// [GET] Tìm kiếm
router.get('/tim-kiem.html', async (req, res, next) => {
  try {
    const keyword = req.query.keyword?.trim() || '';
    const mongoQuery = { isDeleted: false };
    if (keyword) mongoQuery.name = new RegExp(keyword, 'i');

    const [products, categories] = await Promise.all([
      ProductModel.find(mongoQuery).lean(),
      CategoryModel.find({ isDeleted: false }).lean()
    ]);

    res.render('site/tim-kiem', {
      categories,
      products,
      keyword,
      isAuthenticated: req.isAuthenticated()
    });
  } catch (err) {
    next(err);
  }
});

// [GET] Trang chủ
router.get('/', async (req, res, next) => {
  try {
    const [categories, products] = await Promise.all([
      CategoryModel.find({ isDeleted: false }).lean(),
      ProductModel.find({ isDeleted: false }).lean()
    ]);

    // Đếm số lượng sản phẩm mỗi category
    const countByCat = products.reduce((acc, p) => {
      acc[p.categoryId] = (acc[p.categoryId] || 0) + 1;
      return acc;
    }, {});
    categories.forEach(c => c.counter = countByCat[c.id] || 0);

    res.render('site/index', {
      categories,
      products,
      isAuthenticated: req.isAuthenticated()
    });
  } catch (err) {
    next(err);
  }
});

// [GET] Hướng dẫn
router.get('/huong-dan.html', (req, res) => {
  res.render('site/huongdan', { isAuthenticated: req.isAuthenticated() });
});

// [GET] Checkout
router.get('/dat-hang.html', 
  (req, res, next) => Passport.requireAuth(req, res, next, false),
  async (req, res, next) => {
    try {
      const { hasExisted, cart } = getShoppingCart(req);
      if (!hasExisted) return res.redirect('/');

      const data  = cart.getItemList();
      const total = data.reduce((sum, i) => sum + i.quantity * i.price, 0);

      res.render('site/checkout', {
        isAuthenticated: req.isAuthenticated(),
        data,
        total,
        errors: null
      });
    } catch (err) {
      next(err);
    }
  }
);

// [POST] Xử lý đặt hàng
router.post('/dat-hang.html', async (req, res, next) => {
  try {
    const { hasExisted, cart } = getShoppingCart(req);
    if (!hasExisted) return res.redirect('/');

    const currentUser = req.session.user;
    const details     = cart.getItemList();
    const total       = details.reduce((sum, d) => sum + d.quantity * d.price, 0);

    await OrderModel.create({
      name:      req.body.name,
      email:     req.body.email,
      phone:     req.body.phone,
      msg:       req.body.message,
      total,
      status:    OrderStatus.submit,
      ship:      req.body.ship,
      payment:   req.body.payment,
      isDeleted: false,
      userId:    currentUser.id,
      createdAt: moment(),
      details
    });

    req.session.cart = { items: {} };
    res.redirect('/thanh-toan-thanh-cong.html');
  } catch (err) {
    next(err);
  }
});

// [GET] Thanh toán thành công
router.get('/thanh-toan-thanh-cong.html', (req, res) => {
  res.render('site/checkout-success', {
    isAuthenticated: req.isAuthenticated(),
    user: req.session.user
  });
});

// Các route tĩnh khác
router.get('/Payment.html', (req, res) => res.render('site/Payment', { isAuthenticated: req.isAuthenticated() }));
router.get('/dangki.html', (req, res) => res.render('site/dangki', { isAuthenticated: req.isAuthenticated() }));

// [GET] Danh mục
router.get('/danh-muc/:name.:id.html', async (req, res, next) => {
  try {
    const [categories, products] = await Promise.all([
      CategoryModel.find({ isDeleted: false }).lean(),
      ProductModel.find({ categoryId: req.params.id, isDeleted: false }).lean()
    ]);
    res.render('site/category', { categories, products, isAuthenticated: req.isAuthenticated() });
  } catch (err) {
    next(err);
  }
});

// [GET] Chi tiết sản phẩm
router.get('/san-pham/:name.:productId.:categoryId.html', async (req, res, next) => {
  try {
    const data = await ProductModel.findOne({ id: req.params.productId, isDeleted: false }).lean();
    if (!data) return res.redirect('/');

    const products = await ProductModel.find({
      categoryId: data.categoryId,
      isDeleted:  false,
      id: { $ne: data.id }
    }).limit(10).lean();

    res.render('site/product', { data, products, isAuthenticated: req.isAuthenticated() });
  } catch (err) {
    next(err);
  }
});

// [GET] Giỏ hàng
router.get('/gio-hang.html', async (req, res, next) => {
  try {
    const { hasExisted, cart } = getShoppingCart(req);
    const data     = cart.getItemList();
    const products = await ProductModel.find({ isDeleted: false }).lean();

    res.render('site/cart', { data, products, isAuthenticated: req.isAuthenticated() });
  } catch (err) {
    next(err);
  }
});

// Thao tác giỏ hàng
router.get('/cart/add/:id', async (req, res, next) => {
  try {
    const product = await ProductModel.findOne({ id: req.params.id, isDeleted: false }).lean();
    if (product) {
      const { cart } = getShoppingCart(req);
      cart.addItem(product.id, product);
      req.session.cart = cart;
    }
    res.redirect('/gio-hang.html');
  } catch (err) {
    next(err);
  }
});
router.post('/cart/delete', (req, res) => { const { hasExisted, cart } = getShoppingCart(req); if (hasExisted) cart.delete(req.body.id); req.session.cart = cart; res.json({ isSucceed: true }); });
router.post('/cart/update', (req, res) => { const { hasExisted, cart } = getShoppingCart(req); if (hasExisted) cart.updateQuantity(req.body.id, req.body.quantity); req.session.cart = cart; res.json({ isSucceed: true }); });

// menu AJAX
router.post('/menu', async (req, res, next) => { try { const lstCategory = await CategoryModel.find({ isDeleted: false }).lean(); res.json(lstCategory); } catch (err) { next(err); } });

// [GET] Trang Tài khoản
router.get(
  '/tai-khoan.html',
  ensureLoggedIn,
  async (req, res, next) => {
    try {
      const user   = req.session.user;
      const orders = await OrderModel.find({ userId: user.id, isDeleted: false }).sort({ createdAt: -1 }).lean();
      res.render('site/account', {
        isAuthenticated: req.isAuthenticated(),
        user,
        orders,
        moment,
        statusLabels,
        successMessage: req.flash('success')
      });
    } catch (err) {
      next(err);
    }
  }
);

// [POST] Cập nhật thông tin & đổi mật khẩu
router.post(
  '/cap-nhat-thong-tin.html',
  ensureLoggedIn,
  async (req, res, next) => {
    try {
      const { fullname, email, phone, currentPassword, newPassword, confirmPassword } = req.body;
      const userId = req.session.user.id;
      const updateFields = { fullname, email, phone };

      // Xử lý đổi mật khẩu nếu có
      if (currentPassword || newPassword || confirmPassword) {
        if (!currentPassword || !newPassword || !confirmPassword) {
          throw new Error('Vui lòng điền đủ 3 trường đổi mật khẩu.');
        }
        const userInDb = await UserModel.findOne({ id: userId }).lean();
        const match    = await bcrypt.compare(currentPassword, userInDb.password);
        if (!match) throw new Error('Mật khẩu hiện tại không đúng.');
        if (newPassword !== confirmPassword) throw new Error('Mật khẩu mới không khớp.');
        const salt = bcrypt.genSaltSync(16);
        updateFields.password = bcrypt.hashSync(newPassword, salt);
      }

      // Cập nhật User
      const updated = await UserModel.findOneAndUpdate(
        { id: userId },
        updateFields,
        { new: true, runValidators: true }
      ).lean();

      // Cập nhật session
      req.session.user = { ...req.session.user, fullname: updated.fullname, email: updated.email, phone: updated.phone };
      req.flash('success', 'Cập nhật thông tin thành công!');
      res.redirect('/tai-khoan.html');
    } catch (err) {
      console.error(err);
      return res.status(400).send(err.message);
    }
  }
);
// [GET] Trang Liên hệ
router.get('/lien-he.html', async (req, res, next) => {
  try {
    // nếu cần load thêm dữ liệu (vd categories cho menu), bạn có thể:
    // const categories = await CategoryModel.find({ isDeleted: false }).lean();
    res.render('site/lien-he', {
      isAuthenticated: req.isAuthenticated(),
      // categories
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;